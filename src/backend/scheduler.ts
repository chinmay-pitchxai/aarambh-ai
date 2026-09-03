import { processRetries } from "./agents/retry-scheduler";
import { checkDayBeforeReminders, checkDayOfReminders, checkNoShows } from "./agents/reminder-agent";
import { createMemoryBus } from "./agents/bus";
import Redis from "ioredis";
import { startWorker, type WorkerHandle } from "./queue/worker";
import { handleCallJob } from "./queue/workers/call-worker";
import { handleOutcomeJob } from "./queue/workers/outcome-worker";
import { db } from "./db";
import { processCallbacks } from "./services/callback-scheduler";

// ── Scheduler ──
// Runs all periodic tasks via setInterval.

let retryInterval: ReturnType<typeof setInterval> | null = null;
let reminderInterval: ReturnType<typeof setInterval> | null = null;
let noShowInterval: ReturnType<typeof setInterval> | null = null;
let callbackInterval: ReturnType<typeof setInterval> | null = null;
let callWorker: WorkerHandle | null = null;
let outcomeWorker: WorkerHandle | null = null;
let workerRedis: Redis | null = null;

function timestamp(): string {
  return new Date().toISOString();
}

async function runRetries() {
  try {
    const bus = createMemoryBus();
    const result = await processRetries(bus);
    console.log(`[${timestamp()}] [scheduler] retries: expired=${result.expired} retried=${result.retried} completed=${result.completed}`);
  } catch (err) {
    console.error(`[${timestamp()}] [scheduler] retries error:`, err);
  }
}

async function runReminders() {
  try {
    const dayBefore = await checkDayBeforeReminders();
    console.log(`[${timestamp()}] [scheduler] day-before reminders sent: ${dayBefore}`);
  } catch (err) {
    console.error(`[${timestamp()}] [scheduler] day-before reminder error:`, err);
  }

  try {
    const dayOf = await checkDayOfReminders();
    console.log(`[${timestamp()}] [scheduler] day-of reminders sent: ${dayOf}`);
  } catch (err) {
    console.error(`[${timestamp()}] [scheduler] day-of reminder error:`, err);
  }
}

async function runNoShows() {
  try {
    const count = await checkNoShows();
    if (count > 0) {
      console.log(`[${timestamp()}] [scheduler] no-shows detected: ${count}`);
    }
  } catch (err) {
    console.error(`[${timestamp()}] [scheduler] no-show check error:`, err);
  }
}

async function runCallbacks() {
  try {
    const orgs = await db.query.organizations.findMany({ columns: { id: true } });
    for (const org of orgs) {
      const result = await processCallbacks(org.id);
      if (result.initiated > 0) {
        console.log(`[${timestamp()}] [scheduler] callbacks for ${org.id}: initiated=${result.initiated} skipped=${result.skipped}`);
      }
    }
  } catch (err) {
    console.error(`[${timestamp()}] [scheduler] callback error:`, err);
  }
}

export function startScheduler() {
  console.log(`[${timestamp()}] [scheduler] starting...`);

  // Every 60s: process retries
  retryInterval = setInterval(runRetries, 60_000);
  runRetries(); // run once immediately

  // Every 5min: check reminders
  reminderInterval = setInterval(runReminders, 300_000);
  runReminders();

  // Every 60s: detect no-shows
  noShowInterval = setInterval(runNoShows, 60_000);

  // Every 60s: process due callbacks
  callbackInterval = setInterval(runCallbacks, 60_000);
  runCallbacks();

  // Calls are processed outside web requests so the dashboard stays responsive
  // while Vobiz and the voice agent run.
  workerRedis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    connectTimeout: 2_000,
    maxRetriesPerRequest: null,
  });
  callWorker = startWorker(workerRedis, "call-init", async (job, ctx) => {
    await handleCallJob(db, ctx.queue, job as never);
  }, { workerId: "aarambhai-call-worker", concurrency: 3 });

  outcomeWorker = startWorker(workerRedis, "call-outcome", async (job, ctx) => {
    await handleOutcomeJob(db, ctx.queue, job as never);
  }, { workerId: "aarambhai-outcome-worker", concurrency: 5 });

  console.log(`[${timestamp()}] [scheduler] intervals set: retries=60s, reminders=5min, noShows=60s, callbacks=60s, workers=call-init+call-outcome`);
}

export function stopScheduler() {
  if (retryInterval) clearInterval(retryInterval);
  if (reminderInterval) clearInterval(reminderInterval);
  if (noShowInterval) clearInterval(noShowInterval);
  if (callbackInterval) clearInterval(callbackInterval);
  retryInterval = null;
  reminderInterval = null;
  noShowInterval = null;
  callbackInterval = null;
  void callWorker?.stop();
  callWorker = null;
  void outcomeWorker?.stop();
  outcomeWorker = null;
  workerRedis?.disconnect();
  workerRedis = null;
  console.log(`[${timestamp()}] [scheduler] stopped`);
}

// Auto-start when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startScheduler();
  console.log("Scheduler running. Press Ctrl+C to stop.");
  process.on("SIGINT", () => {
    stopScheduler();
    process.exit(0);
  });
}
