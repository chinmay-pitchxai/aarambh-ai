import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { createDurableQueue, type DurableQueue, type Job } from "./durable-queue";

export interface WorkerJobContext {
  workerId: string;
  jobId: string;
  queue: DurableQueue;
  signal: AbortSignal;
  extendLease: (extensionMs?: number) => Promise<boolean>;
}

export type JobHandler = (job: Job, ctx: WorkerJobContext) => Promise<void>;

export interface WorkerOptions {
  workerId?: string;
  concurrency?: number;
  maxConcurrent?: number;
  pollIntervalMs?: number;
  leaseExtensionMs?: number;
  leaseExtensionIntervalMs?: number;
  stopTimeoutMs?: number;
  onError?: (job: Job, error: unknown) => void;
}

export interface WorkerHandle {
  workerId: string;
  queue: DurableQueue;
  stop: () => Promise<void>;
}

const DEFAULTS = {
  concurrency: 5,
  maxConcurrent: 20,
  pollIntervalMs: 250,
  leaseExtensionMs: 30_000,
  leaseExtensionIntervalMs: 10_000,
  stopTimeoutMs: 30_000,
};

export function startWorker(
  redis: Redis,
  queueName: string,
  handler: JobHandler,
  options: WorkerOptions = {},
): WorkerHandle {
  const opts = { ...DEFAULTS, ...options };
  const queue = createDurableQueue(redis, queueName);
  const workerId = options.workerId ?? `worker_${queueName}_${randomUUID()}`;
  const controller = new AbortController();
  let running = true;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const inFlight = new Map<string, Promise<void>>();
  const leaseTimers = new Set<ReturnType<typeof setInterval>>();

  async function processJob(job: Job): Promise<void> {
    const leaseTimer = setInterval(() => {
      queue.extendLease(job.id, workerId, opts.leaseExtensionMs).catch(() => {});
    }, opts.leaseExtensionIntervalMs);
    leaseTimers.add(leaseTimer);

    const ctx: WorkerJobContext = {
      workerId,
      jobId: job.id,
      queue,
      signal: controller.signal,
      extendLease: (extensionMs) => queue.extendLease(job.id, workerId, extensionMs ?? opts.leaseExtensionMs),
    };

    try {
      await handler(job, ctx);
      await queue.complete(job.id, workerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await queue.fail(job.id, workerId, message);
      } finally {
        if (options.onError) {
          try {
            options.onError(job, error);
          } catch {
            // error handler failures must not crash the worker
          }
        }
      }
    } finally {
      clearInterval(leaseTimer);
      leaseTimers.delete(leaseTimer);
    }
  }

  function scheduleNext(immediate: boolean): void {
    if (!running) return;
    pollTimer = setTimeout(() => {
      void pumpLoop();
    }, immediate ? 0 : opts.pollIntervalMs);
  }

  async function pumpLoop(): Promise<void> {
    if (!running) return;
    let acquired = 0;
    try {
      const available = opts.maxConcurrent - inFlight.size;
      if (available > 0) {
        const jobs = await queue.acquireLease(workerId, Math.min(available, opts.concurrency));
        acquired = jobs.length;
        for (const job of jobs) {
          const task = processJob(job);
          inFlight.set(job.id, task);
          void task.finally(() => {
            inFlight.delete(job.id);
          });
        }
      }
    } catch {
      // transient queue/redis failures should not stop the worker
    } finally {
      scheduleNext(acquired > 0 && inFlight.size < opts.maxConcurrent);
    }
  }

  async function stop(): Promise<void> {
    running = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    const tasks = [...inFlight.values()];
    if (tasks.length > 0) {
      await Promise.race([
        Promise.allSettled(tasks),
        new Promise<void>((resolve) => {
          setTimeout(resolve, opts.stopTimeoutMs);
        }),
      ]);
    }
    controller.abort();
    for (const timer of leaseTimers) clearInterval(timer);
    leaseTimers.clear();
  }

  scheduleNext(true);

  return { workerId, queue, stop };
}