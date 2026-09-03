import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { detectIntent } from "./intent";
import { generateReply } from "./conversational-ai";
import { saveConversationTurn } from "./conversation-memory";
import type { Db, InboundMessage, InboundProcessResult, MessageChannel } from "./types";

export interface ProcessInboundInput {
  channel: MessageChannel;
  message: InboundMessage & { leadId: string; clientId: string };
}

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
    detectedInterest: intent === "interested" || intent === "meeting_request",
    receivedAt: message.receivedAt ?? new Date(),
  });

  if (intent === "dnc") {
    await handleOptOut(db, { leadId, clientId });
    return { intent, action: "dnc", leadId, clientId };
  }

  if (intent === "meeting_request") {
    await db
      .update(schema.clientLeads)
      .set({ status: "qualified", lastCallAt: new Date() })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

    const slots = await offerAndFormatSlots(db, { clientId, leadId });
    const slotMessage = slots.length > 0
      ? `\n\nHere are some available time slots:\n${slots}`
      : "";

    const lead = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).limit(1);
    const leadName = lead[0]?.firstName || "there";

    const reply = `Great to hear you'd like to schedule a meeting, ${leadName}!${slotMessage}\n\nJust reply with the slot that works best for you, or let me know your preferred time and I'll get it set up.`;

    await saveConversationTurn(db, {
      leadId,
      clientId,
      channel,
      direction: "outbound",
      body: reply,
    });

    return { intent, action: "meeting_request", leadId, clientId, reply, replySent: true };
  }

  if (intent === "interested") {
    await db
      .update(schema.clientLeads)
      .set({ status: "qualified", lastCallAt: new Date() })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

    const lead = await db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).limit(1);
    const leadName = lead[0]?.firstName || "there";

    const reply = `Thanks for your interest, ${leadName}! I'd love to help you get started. Would you like to schedule a quick meeting to discuss how we can help? Just let me know a time that works for you.`;

    await saveConversationTurn(db, {
      leadId,
      clientId,
      channel,
      direction: "outbound",
      body: reply,
    });

    return { intent, action: "interested", leadId, clientId, reply, replySent: true };
  }

  if (intent === "neutral" || intent === "question") {
    try {
      const replyResult = await generateReply(db, {
        tenantId: message.tenantId ?? clientId,
        leadId,
        clientId,
        channel,
        incomingMessage: message.body,
      });

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

async function offerAndFormatSlots(
  db: Db,
  opts: { clientId: string; leadId: string },
): Promise<string> {
  try {
    const { offerSlots } = await import("../calendar/booking");
    const slots = await offerSlots(db, opts.clientId, opts.leadId);
    if (slots.length === 0) return "";

    return slots
      .map((slot, i) => {
        const startStr = slot.start.toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        });
        const endStr = slot.end.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        });
        return `${i + 1}. ${startStr} - ${endStr} IST`;
      })
      .join("\n");
  } catch {
    return "";
  }
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