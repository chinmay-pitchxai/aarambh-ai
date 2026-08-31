import type { AgentContext } from "./types";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Inbound Handler Agent ──
// Processes WhatsApp and Gmail replies, detects interest, routes accordingly.

const INTEREST_KEYWORDS = ["interested", "yes", "sure", "book", "meeting", "call me", "tell me more", "demo"];
const DISINTEREST_KEYWORDS = ["not interested", "no", "stop", "unsubscribe", "don't call", "remove"];

function detectSentiment(body: string): "interested" | "not_interested" | "neutral" {
  const lower = body.toLowerCase();

  for (const keyword of DISINTEREST_KEYWORDS) {
    if (lower.includes(keyword)) return "not_interested";
  }
  for (const keyword of INTEREST_KEYWORDS) {
    if (lower.includes(keyword)) return "interested";
  }
  return "neutral";
}

async function updateLeadStatus(leadId: string, clientId: string, status: "booked" | "lost") {
  const [existing] = await db
    .select()
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)))
    .limit(1);

  if (!existing) return;

  const updateData: Record<string, unknown> = { status };
  if (status === "lost") updateData.lostAt = new Date();

  await db
    .update(schema.clientLeads)
    .set(updateData)
    .where(eq(schema.clientLeads.id, existing.id));
}

function makeStubCtx(leadId: string, clientId: string): AgentContext {
  return {
    leadId,
    clientId,
    bus: { publish() {}, subscribe() { return () => {}; } },
    store: {
      async get() { return null; },
      async set() {},
      async del() {},
      async recall(leadId: string) {
        return { leadId, calls: [], messages: [], lastPitch: null, lastSentiment: null, totalAttempts: 0 };
      },
      async saveMemory() {},
    },
    log: (msg: string, data?: unknown) => console.log(`[inbound-handler] ${msg}`, data),
  };
}

export async function processInboundWhatsApp(message: {
  leadId: string;
  clientId: string;
  body: string;
  timestamp?: Date;
}) {
  const { leadId, clientId, body, timestamp } = message;

  const detected = detectSentiment(body);

  await db.insert(schema.inboundMessages).values({
    id: randomUUID(),
    leadId,
    clientId,
    channel: "whatsapp",
    body,
    detectedInterest: detected === "interested",
    receivedAt: timestamp || new Date(),
  });

  if (detected === "interested") {
    await updateLeadStatus(leadId, clientId, "booked");

    const { confirmBooking } = await import("./booking-confirmer");
    await confirmBooking({ leadId, clientId }, makeStubCtx(leadId, clientId));
  } else if (detected === "not_interested") {
    await updateLeadStatus(leadId, clientId, "lost");
  }

  return { detected, messageStored: true };
}

export async function processInboundGmail(message: {
  leadId: string;
  clientId: string;
  subject: string;
  body: string;
  timestamp?: Date;
}) {
  const { leadId, clientId, subject, body, timestamp } = message;

  const detected = detectSentiment(body);

  await db.insert(schema.inboundMessages).values({
    id: randomUUID(),
    leadId,
    clientId,
    channel: "email",
    body: `[${subject}] ${body}`,
    detectedInterest: detected === "interested",
    receivedAt: timestamp || new Date(),
  });

  if (detected === "interested") {
    await updateLeadStatus(leadId, clientId, "booked");

    const { confirmBooking } = await import("./booking-confirmer");
    await confirmBooking({ leadId, clientId }, makeStubCtx(leadId, clientId));
  } else if (detected === "not_interested") {
    await updateLeadStatus(leadId, clientId, "lost");
  }

  return { detected, messageStored: true };
}

export async function handleNoReply(leadId: string, clientId: string) {
  const [existing] = await db
    .select()
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)))
    .limit(1);

  if (!existing) return { timedOut: false };

  if (existing.status === "booked") {
    return { timedOut: false };
  }

  await db
    .update(schema.clientLeads)
    .set({ status: "lost", lostAt: new Date() } as never)
    .where(eq(schema.clientLeads.id, existing.id));

  return { timedOut: true };
}
