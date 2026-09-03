import { db, schema } from "../../db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DurableQueue, Job } from "../durable-queue";
import { routeOutcome, type CallOutcome } from "../../agents/outcome-router";
import type { AgentContext, MessageBus } from "../../agents/types";

// ── Outcome Worker ──
// Processes call-outcome jobs from the durable queue.
// These jobs are enqueued by call-engine.routeOutcome() after a call's
// terminal event (completed/failed) is received via webhook.
// This worker invokes the real outcome router which sends WhatsApp messages,
// schedules retries, creates bookings, etc.

interface OutcomeJobPayload {
  leadId: string;
  clientId: string;
  callId: string;
  outcome: CallOutcome;
}

function createStubContext(leadId: string, clientId: string, queue: DurableQueue): AgentContext {
  const bus: MessageBus = {
    publish() {},
    subscribe() {
      return () => {};
    },
  };

  return {
    leadId,
    clientId,
    bus,
    store: {
      async get() {
        return null;
      },
      async set() {},
      async del() {},
      async recall(id: string) {
        return {
          leadId: id,
          calls: [],
          messages: [],
          lastPitch: null,
          lastSentiment: null,
          totalAttempts: 0,
        };
      },
      async saveMemory() {},
    },
    log: (msg: string, data?: unknown) =>
      console.log(`[outcome-worker] ${msg}`, data),
  };
}

export async function handleOutcomeJob(
  db: any,
  queue: DurableQueue,
  job: Job<OutcomeJobPayload>,
): Promise<void> {
  const { leadId, clientId, callId, outcome } = job.payload;

  const ctx = createStubContext(leadId, clientId, queue);

  try {
    const result = await routeOutcome(leadId, clientId, callId, outcome, ctx);
    console.log(
      `[outcome-worker] processed outcome=${outcome} for lead=${leadId}: nextAction=${result.nextAction}`,
    );
  } catch (err) {
    console.error(
      `[outcome-worker] failed to process outcome=${outcome} for lead=${leadId}:`,
      err,
    );
    throw err;
  }
}
