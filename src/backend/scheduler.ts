import { processRetries } from "./agents/retry-scheduler";
import { checkDayBeforeReminders, checkDayOfReminders, checkNoShows } from "./agents/reminder-agent";
import { createMemoryBus } from "./agents/bus";

// ── Scheduler ──
// Runs all periodic tasks via setInterval.

let retryInterval: ReturnType<typeof setInterval> | null = null;
let reminderInterval: ReturnType<typeof setInterval> | null = null;
let noShowInterval: ReturnType<typeof setInterval> | null = null;

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

  console.log(`[${timestamp()}] [scheduler] intervals set: retries=60s, reminders=5min, noShows=60s`);
}

export function stopScheduler() {
  if (retryInterval) clearInterval(retryInterval);
  if (reminderInterval) clearInterval(reminderInterval);
  if (noShowInterval) clearInterval(noShowInterval);
  retryInterval = null;
  reminderInterval = null;
  noShowInterval = null;
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
