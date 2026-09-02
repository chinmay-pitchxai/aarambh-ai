import Redis from "ioredis";
import { randomUUID } from "node:crypto";

// ── Priority Levels ──
export const JOB_PRIORITY = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
} as const;
export type JobPriority = keyof typeof JOB_PRIORITY;

// ── Job Status ──
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "dlq";

// ── Job Definition ──
export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  priority: JobPriority;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  createdAt: string;
  runAt: string;
  leaseExpiresAt: string | null;
  processingBy: string | null;
  lastError: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  tenantId: string;
  correlationId: string;
  causationId: string | null;
}

export interface EnqueueOptions {
  priority?: JobPriority;
  delayMs?: number;
  runAt?: Date;
  maxAttempts?: number;
  tenantId?: string;
  correlationId?: string;
  causationId?: string;
}

// ── Queue Keys ──
function keys(queueName: string) {
  const base = `dq:${queueName}`;
  return {
    pending: `${base}:pending`,       // sorted set: score = runAt timestamp
    processing: `${base}:processing`, // hash: jobId → leaseExpiresAt
    completed: `${base}:completed`,   // sorted set: score = completedAt
    failed: `${base}:failed`,         // sorted set: score = failedAt
    dlq: `${base}:dlq`,              // sorted set: score = movedAt
    job: (id: string) => `${base}:job:${id}`,
    index: `${base}:index`,           // hash: jobId → status (for lookups)
  };
}

// ── Durable Queue ──
export interface DurableQueue {
  enqueue<T = unknown>(type: string, payload: T, options?: EnqueueOptions): Promise<string>;

  acquireLease(workerId: string, count?: number): Promise<Job[]>;

  complete(jobId: string, workerId: string): Promise<void>;

  fail(jobId: string, workerId: string, error: string): Promise<void>;

  extendLease(jobId: string, workerId: string, extensionMs: number): Promise<boolean>;

  moveToDlq(jobId: string, reason: string): Promise<void>;

  getJob(jobId: string): Promise<Job | null>;

  getStats(queueName: string): Promise<QueueStats>;

  listJobs(queueName: string, status: JobStatus, options?: { limit?: number; offset?: number }): Promise<Job[]>;

  cancelJob(jobId: string): Promise<void>;

  requeueJob(jobId: string): Promise<void>;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dlq: number;
}

const LEASE_DURATION_MS = 30_000;
const MAX_BACKOFF_MS = 300_000;
const BASE_BACKOFF_MS = 5_000;

function exponentialBackoff(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
}

export function createDurableQueue(redis: Redis, queueName: string): DurableQueue {
  const k = keys(queueName);

  async function serializeJob(job: Job): Promise<string> {
    return JSON.stringify(job);
  }

  async function deserializeJob(raw: string | null): Promise<Job | null> {
    if (!raw) return null;
    return JSON.parse(raw);
  }

  return {
    async enqueue<T = unknown>(type: string, payload: T, options: EnqueueOptions = {}) {
      const now = Date.now();
      const jobId = randomUUID();
      const delayMs = options.delayMs ?? 0;
      const runAt = options.runAt
        ? options.runAt.getTime()
        : now + delayMs;

      const job: Job<T> = {
        id: jobId,
        type,
        payload,
        priority: options.priority ?? "normal",
        status: "pending",
        attempt: 0,
        maxAttempts: options.maxAttempts ?? 5,
        createdAt: new Date(now).toISOString(),
        runAt: new Date(runAt).toISOString(),
        leaseExpiresAt: null,
        processingBy: null,
        lastError: null,
        retryCount: 0,
        nextRetryAt: null,
        tenantId: options.tenantId ?? "system",
        correlationId: options.correlationId ?? randomUUID(),
        causationId: options.causationId ?? null,
      };

      const priorityScore = JOB_PRIORITY[job.priority];
      const compositeScore = runAt * 100 + priorityScore;

      const pipeline = redis.pipeline();
      pipeline.zadd(k.pending, compositeScore, jobId);
      pipeline.set(k.job(jobId), await serializeJob(job));
      pipeline.hset(k.index, jobId, "pending");
      await pipeline.exec();

      return jobId;
    },

    async acquireLease(workerId, count = 1) {
      const now = Date.now();
      const leased: Job[] = [];

      for (let i = 0; i < count; i++) {
        const result = await redis.zpopmin(k.pending, 1);
        if (!result || result.length === 0) break;

        const [jobId] = result[0];
        const raw = await redis.get(k.job(jobId));
        if (!raw) continue;

        const job = await deserializeJob(raw);
        if (!job) continue;

        if (new Date(job.runAt).getTime() > now) {
          await redis.zadd(k.pending, new Date(job.runAt).getTime() * 100 + JOB_PRIORITY[job.priority], jobId);
          continue;
        }

        const leaseExpiry = new Date(now + LEASE_DURATION_MS);
        job.status = "processing";
        job.leaseExpiresAt = leaseExpiry.toISOString();
        job.processingBy = workerId;
        job.attempt += 1;

        const pipeline = redis.pipeline();
        pipeline.set(k.job(jobId), await serializeJob(job));
        pipeline.hset(k.processing, jobId, leaseExpiry.getTime().toString());
        pipeline.hset(k.index, jobId, "processing");
        await pipeline.exec();

        leased.push(job);
      }

      return leased;
    },

    async complete(jobId, workerId) {
      const raw = await redis.get(k.job(jobId));
      if (!raw) return;
      const job = await deserializeJob(raw);
      if (!job || job.processingBy !== workerId) return;

      job.status = "completed";
      job.leaseExpiresAt = null;
      job.processingBy = null;

      const now = Date.now();
      const pipeline = redis.pipeline();
      pipeline.set(k.job(jobId), await serializeJob(job));
      pipeline.hdel(k.processing, jobId);
      pipeline.zadd(k.completed, now, jobId);
      pipeline.hset(k.index, jobId, "completed");
      await pipeline.exec();
    },

    async fail(jobId, workerId, error) {
      const raw = await redis.get(k.job(jobId));
      if (!raw) return;
      const job = await deserializeJob(raw);
      if (!job || job.processingBy !== workerId) return;

      job.lastError = error;
      job.retryCount += 1;
      job.processingBy = null;
      job.leaseExpiresAt = null;

      if (job.retryCount >= job.maxAttempts) {
        job.status = "dlq";
        const now = Date.now();
        const pipeline = redis.pipeline();
        pipeline.set(k.job(jobId), await serializeJob(job));
        pipeline.hdel(k.processing, jobId);
        pipeline.zadd(k.dlq, now, jobId);
        pipeline.hset(k.index, jobId, "dlq");
        await pipeline.exec();
        return;
      }

      const backoff = exponentialBackoff(job.retryCount);
      const nextRetryAt = new Date(Date.now() + backoff);
      job.status = "pending";
      job.nextRetryAt = nextRetryAt.toISOString();
      job.runAt = nextRetryAt.toISOString();

      const compositeScore = nextRetryAt.getTime() * 100 + JOB_PRIORITY[job.priority];
      const pipeline = redis.pipeline();
      pipeline.set(k.job(jobId), await serializeJob(job));
      pipeline.hdel(k.processing, jobId);
      pipeline.zadd(k.pending, compositeScore, jobId);
      pipeline.hset(k.index, jobId, "pending");
      await pipeline.exec();
    },

    async extendLease(jobId, workerId, extensionMs) {
      const raw = await redis.get(k.job(jobId));
      if (!raw) return false;
      const job = await deserializeJob(raw);
      if (!job || job.processingBy !== workerId) return false;

      const newExpiry = new Date(Date.now() + extensionMs);
      job.leaseExpiresAt = newExpiry.toISOString();

      const pipeline = redis.pipeline();
      pipeline.set(k.job(jobId), await serializeJob(job));
      pipeline.hset(k.processing, jobId, newExpiry.getTime().toString());
      await pipeline.exec();

      return true;
    },

    async moveToDlq(jobId, reason) {
      const raw = await redis.get(k.job(jobId));
      if (!raw) return;
      const job = await deserializeJob(raw);
      if (!job) return;

      job.status = "dlq";
      job.lastError = reason;
      job.leaseExpiresAt = null;
      job.processingBy = null;

      const now = Date.now();
      const pipeline = redis.pipeline();
      pipeline.set(k.job(jobId), await serializeJob(job));
      pipeline.hdel(k.processing, jobId);
      pipeline.zadd(k.dlq, now, jobId);
      pipeline.hset(k.index, jobId, "dlq");
      await pipeline.exec();
    },

    async getJob(jobId) {
      const raw = await redis.get(k.job(jobId));
      return deserializeJob(raw);
    },

    async getStats(queueName) {
      const qk = keys(queueName);
      const [pending, processing, completed, failed, dlq] = await Promise.all([
        redis.zcard(qk.pending),
        redis.hlen(qk.processing),
        redis.zcard(qk.completed),
        redis.zcard(qk.failed),
        redis.zcard(qk.dlq),
      ]);
      return { pending, processing, completed, failed, dlq };
    },

    async listJobs(queueName, status, { limit = 50, offset = 0 } = {}) {
      const qk = keys(queueName);
      let jobIds: string[];

      switch (status) {
        case "pending":
          jobIds = await redis.zrange(qk.pending, offset, offset + limit - 1);
          break;
        case "processing":
          jobIds = await redis.hkeys(qk.processing);
          jobIds = jobIds.slice(offset, offset + limit);
          break;
        case "completed":
          jobIds = await redis.zrange(qk.completed, offset, offset + limit - 1);
          break;
        case "failed":
          jobIds = await redis.zrange(qk.failed, offset, offset + limit - 1);
          break;
        case "dlq":
          jobIds = await redis.zrange(qk.dlq, offset, offset + limit - 1);
          break;
        default:
          jobIds = [];
      }

      const jobs: Job[] = [];
      for (const id of jobIds) {
        const job = await this.getJob(id);
        if (job) jobs.push(job);
      }
      return jobs;
    },

    async cancelJob(jobId) {
      const raw = await redis.get(k.job(jobId));
      if (!raw) return;
      const job = await deserializeJob(raw);
      if (!job) return;

      if (job.status === "completed" || job.status === "dlq") return;

      job.status = "failed";
      job.lastError = "cancelled";
      job.leaseExpiresAt = null;
      job.processingBy = null;

      const pipeline = redis.pipeline();
      pipeline.set(k.job(jobId), await serializeJob(job));
      pipeline.hdel(k.processing, jobId);
      pipeline.zadd(k.failed, Date.now(), jobId);
      pipeline.hset(k.index, jobId, "failed");
      await pipeline.exec();
    },

    async requeueJob(jobId) {
      const raw = await redis.get(k.job(jobId));
      if (!raw) return;
      const job = await deserializeJob(raw);
      if (!job) return;

      if (job.status !== "dlq" && job.status !== "failed") return;

      const now = Date.now();
      job.status = "pending";
      job.attempt = 0;
      job.retryCount = 0;
      job.nextRetryAt = null;
      job.lastError = null;
      job.runAt = new Date(now).toISOString();
      job.leaseExpiresAt = null;
      job.processingBy = null;

      const compositeScore = now * 100 + JOB_PRIORITY[job.priority];
      const pipeline = redis.pipeline();
      pipeline.set(k.job(jobId), await serializeJob(job));
      pipeline.hdel(k.processing, jobId);
      pipeline.zadd(k.pending, compositeScore, jobId);
      pipeline.hdel(k.failed, jobId);
      pipeline.hdel(k.dlq, jobId);
      pipeline.hset(k.index, jobId, "pending");
      await pipeline.exec();
    },
  };
}
