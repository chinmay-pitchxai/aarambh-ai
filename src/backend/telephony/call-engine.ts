import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { DurableQueue } from "../queue/durable-queue";
import { isDnc, isInCallingWindow, canInitiateCall } from "./suppression";
import type { CallOutcome } from "../agents/outcome-router";

// ── Call Engine ──
// Orchestrates call initiation, webhook event processing, and outcome routing.
// All state transitions are event-driven; no Math.random(), no fake outcomes.

interface InitiateCallInput {
  tenantId: string;
  leadId: string;
  fromNumber: string;
}

interface CallEngineEvent {
  callId?: string;
  vobizCallId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  clientId?: string;
  leadId?: string;
  timestamp?: string;
}

// ── Initiate Call ──

export async function initiateCall(
  db: any,
  queue: DurableQueue,
  input: InitiateCallInput,
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  const { tenantId, leadId, fromNumber } = input;

  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) return { success: false, error: "Lead not found" };
  if (!lead.phoneE164) return { success: false, error: "Lead has no phone number" };

  if (await isDnc(db, lead.phoneE164)) {
    return { success: false, error: "Lead is on DNC list" };
  }

  if (!isInCallingWindow(new Date())) {
    return { success: false, error: "Outside calling window (9am-6pm Mon-Sat)" };
  }

  if (!(await canInitiateCall(db, tenantId))) {
    return { success: false, error: "Capacity limit reached" };
  }

  const [clientLead] = await db
    .select()
    .from(schema.clientLeads)
    .where(
      and(
        eq(schema.clientLeads.leadId, leadId),
        eq(schema.clientLeads.clientId, tenantId),
      ),
    )
    .limit(1);

  const attemptNumber = (clientLead?.attemptCount ?? 0) + 1;

  const jobId = await queue.enqueue("call-init", {
    tenantId,
    leadId,
    clientId: tenantId,
    fromNumber,
    toNumber: lead.phoneE164,
    attemptNumber,
  }, {
    priority: "high",
    tenantId,
  });

  return { success: true, jobId };
}

// ── Handle Call Event ──

export async function handleCallEvent(
  db: any,
  queue: DurableQueue,
  event: CallEngineEvent,
): Promise<void> {
  const vobizCallId = event.vobizCallId || event.callId;
  if (!vobizCallId) return;

  const [existingCall] = await db
    .select()
    .from(schema.calls)
    .where(eq(schema.calls.vobizCallId, vobizCallId))
    .limit(1);

  if (!existingCall) return;

  const eventType = event.eventType;
  const payload = event.payload as Record<string, unknown>;

  switch (eventType) {
    case "call.initiated": {
      await db
        .update(schema.calls)
        .set({ startedAt: new Date() })
        .where(eq(schema.calls.id, existingCall.id));
      break;
    }

    case "call.ringing": {
      break;
    }

    case "call.answered": {
      await db
        .update(schema.calls)
        .set({ startedAt: new Date() })
        .where(eq(schema.calls.id, existingCall.id));
      break;
    }

    case "call.completed":
    case "call.failed": {
      const outcome = determineOutcome(eventType, payload);
      const durationSec =
        typeof payload.duration === "number"
          ? Math.round(payload.duration)
          : typeof payload.duration_sec === "number"
            ? Math.round(payload.duration_sec)
            : existingCall.durationSec ?? 0;
      const recordingUrl =
        (payload.recording_url as string) ||
        (payload.recordingUrl as string) ||
        existingCall.recordingUrl;

      await db
        .update(schema.calls)
        .set({
          outcome,
          durationSec,
          recordingUrl: recordingUrl ?? undefined,
          endedAt: new Date(),
        })
        .where(eq(schema.calls.id, existingCall.id));

      await routeOutcome(db, queue, existingCall, outcome, event.clientId);
      break;
    }
  }
}

// ── Determine Outcome ──

function determineOutcome(
  eventType: string,
  payload: Record<string, unknown>,
): CallOutcome {
  if (eventType === "call.failed") return "failed";

  const status = (payload.status as string) || "";
  const hangupCause = (payload.hangup_cause as string) || (payload.hangupCause as string) || "";

  if (status === "no_answer" || hangupCause === "no_answer") return "no_answer";
  if (status === "busy" || hangupCause === "busy") return "failed";

  return "picked_no_response";
}

// ── Route Outcome ──

export async function routeOutcome(
  db: any,
  queue: DurableQueue,
  call: { id: string; leadId: string; clientId: string },
  outcome: CallOutcome,
  clientId?: string,
): Promise<void> {
  const resolvedClientId = clientId || call.clientId;

  await db
    .update(schema.calls)
    .set({ outcome })
    .where(eq(schema.calls.id, call.id));

  // Enqueue outcome processing — the outcome worker invokes the full
  // outcome router (WhatsApp sends, retries, booking, lead status updates).
  await queue.enqueue("call-outcome", {
    leadId: call.leadId,
    clientId: resolvedClientId,
    callId: call.id,
    outcome,
  }, {
    priority: "normal",
    tenantId: resolvedClientId,
    correlationId: call.id,
  });
}
