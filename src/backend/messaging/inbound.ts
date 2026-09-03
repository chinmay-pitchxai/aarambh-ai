import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { detectIntent } from "./intent";
import { generateReply } from "./conversational-ai";
import { saveConversationTurn } from "./conversation-memory";
import type { Db, InboundMessage, InboundProcessResult, MessageChannel } from "./types";

export interface ProcessInboundInput {
  channel: MessageChannel;
  /** leadId/clientId must be resolved by the calling adapter. */
  message: InboundMessage & { leadId: string; clientId: string };
}

/**
 * Routes a normalized inbound message to its intent handler:
 *  - DNC/opt-out: persist consent opt-out, set the global DNC flag, mark the
 *    client lead as dnc and cancel all pending retry/outreach jobs.
 *  - Interested: flip the client lead to booked and enqueue a booking job.
 *  - Neutral: persisted only.
 */
export async function processInboundMessage(
  db: Db,
  input: ProcessInboundInput,
): Promise<InboundProcessResult> {
  const { channel, message } = input;
  const { leadId, clientId } = message;
  const intent = detectIntent(message.body);

  await db.insert(schema.inboundMessages).values({
    id: randomUUID(),
    leadId,
    clientId,
    channel: channel === "whatsapp" ? "whatsapp" : "email",
    body: channel === "gmail" && message.subject ? `[${message.subject}] ${message.body}` : message.body,
    detectedInterest: intent === "interested",
    receivedAt: message.receivedAt ?? new Date(),
  });

  if (intent === "dnc") {
    await handleOptOut(db, { leadId, clientId });
    return { intent, action: "dnc", leadId, clientId };
  }

  if (intent === "interested") {
    await db
      .update(schema.clientLeads)
      .set({ status: "booked", lastCallAt: new Date() })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));
    await enqueueBookingJob(db, { leadId, clientId, tenantId: message.tenantId ?? clientId });
    return { intent, action: "interested", leadId, clientId };
  }

  // For neutral and question intents, generate a conversational reply
  if (intent === "neutral" || intent === "question") {
    try {
      const replyResult = await generateReply(db, {
        tenantId: message.tenantId ?? clientId,
        leadId,
        clientId,
        channel,
        incomingMessage: message.body,
      });

      // Save the outbound reply to conversation history
      await saveConversationTurn(db, {
        leadId,
        clientId,
        channel,
        direction: "outbound",
        body: replyResult.reply,
      });

      return {
        intent,
        action: intent,
        leadId,
        clientId,
        reply: replyResult.reply,
        replySent: true,
      };
    } catch (err) {
      console.error(`[inbound] conversational reply failed for lead ${leadId}:`, err);
      return { intent, action: intent, leadId, clientId, replySent: false };
    }
  }

  return { intent, action: "neutral", leadId, clientId };
}

async function handleOptOut(
  db: Db,
  opts: { leadId: string; clientId: string },
): Promise<void> {
  const { leadId, clientId } = opts;

  const [existingConsent] = await db
    .select()
    .from(schema.consent)
    .where(and(eq(schema.consent.leadId, leadId), eq(schema.consent.clientId, clientId)))
    .limit(1);

  if (existingConsent) {
    await db
      .update(schema.consent)
      .set({ status: "opted_out", source: "inbound_message", checkedAt: new Date() })
      .where(and(eq(schema.consent.leadId, leadId), eq(schema.consent.clientId, clientId)));
  } else {
    await db.insert(schema.consent).values({
      id: randomUUID(),
      leadId,
      clientId,
      status: "opted_out",
      source: "inbound_message",
    });
  }

  // Global DNC + per-client lead status.
  await db.update(schema.leads).set({ dnc: 1 }).where(eq(schema.leads.id, leadId));
  await db
    .update(schema.clientLeads)
    .set({ status: "dnc", nextRetryAt: null })
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

  // Cancel future outreach: pending retry jobs and pending queue jobs for this lead.
  await db
    .update(schema.retryQueue)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.retryQueue.leadId, leadId),
        eq(schema.retryQueue.clientId, clientId),
        eq(schema.retryQueue.status, "pending"),
      ),
    );

  await db
    .update(schema.queueJobs)
    .set({ status: "cancelled" })
    .where(
      sql`${schema.queueJobs.payload}->>'leadId' = ${leadId} AND ${schema.queueJobs.status} = 'pending'`,
    );
}

async function enqueueBookingJob(
  db: Db,
  opts: { leadId: string; clientId: string; tenantId: string },
): Promise<void> {
  await db.insert(schema.queueJobs).values({
    tenantId: opts.tenantId,
    queue: "inbound",
    type: "booking.confirm",
    jobType: "booking.confirm",
    payload: { leadId: opts.leadId, clientId: opts.clientId },
    priority: "high",
    status: "pending",
    maxAttempts: 3,
    runAfter: new Date(),
  });

  // Preserve the legacy confirmation behavior best-effort; a durable job has
  // already been recorded so failures here never lose the booking intent.
  try {
    const { confirmBooking } = await import("../agents/booking-confirmer");
    await confirmBooking({ leadId: opts.leadId, clientId: opts.clientId }, makeStubCtx(opts.leadId, opts.clientId));
  } catch (err) {
    console.error(`[messaging] booking confirmation failed for lead ${opts.leadId}:`, err);
  }
}

function makeStubCtx(leadId: string, clientId: string) {
  return {
    leadId,
    clientId,
    bus: { publish() {}, subscribe() { return () => {}; } },
    store: {
      async get() { return null; },
      async set() {},
      async del() {},
      async recall(lead: string) {
        return { leadId: lead, calls: [], messages: [], lastPitch: null, lastSentiment: null, totalAttempts: 0 };
      },
      async saveMemory() {},
    },
    log: (msg: string, data?: unknown) => console.log(`[inbound-router] ${msg}`, data),
  };
}