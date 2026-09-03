import type { AgentContext, MessageBus } from "./types";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { createNotificationForTenant, formatNotificationMessage } from "../services/notifications";

// ── Outcome Router ──
// Replaces the switch statement in pipeline.ts.
// Handles every possible call outcome and routes to the correct next step.

export type CallOutcome =
  | "initiated"
  | "interested"
  | "not_interested"
  | "no_answer"
  | "busy"
  | "failed"
  | "picked_no_response"
  | "booked";

export interface OutcomeResult {
  nextAction:
    | "wait_reply"
    | "lost"
    | "retry"
    | "confirm_booking";
  nudgeSent: boolean;
  retryAt?: Date;
  messagesSent?: number;
}

// ── Helpers ──

const WA_API = "https://graph.facebook.com/v19.0";
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WA_TOKEN = process.env.WHATSAPP_API_TOKEN;

async function sendWhatsApp(phoneE164: string | null, templateName: string, params: string[]): Promise<string | null> {
  if (!phoneE164) return null;
  if (!WA_PHONE_ID || !WA_TOKEN) {
    console.log(`[WA-STUB] To: ${phoneE164}, Template: ${templateName}`);
    return `wa-stub-${randomUUID().slice(0, 8)}`;
  }

  const res = await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phoneE164,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }],
      },
    }),
  });

  if (!res.ok) {
    console.error(`WA send failed: ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data.messages?.[0]?.id || null;
}

async function sendGmail(to: string, subject: string, body: string): Promise<string | null> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !refreshToken) {
    console.log(`[GMAIL-STUB] To: ${to}, Subject: ${subject}`);
    return `gmail-stub-${randomUUID().slice(0, 8)}`;
  }
  return null;
}

async function storeMessage(
  leadId: string,
  clientId: string,
  callId: string | null,
  channel: string,
  body: string,
  ids: { waMessageId?: string | null; gmailThreadId?: string | null },
) {
  await db.insert(schema.messages).values({
    id: randomUUID(),
    leadId,
    clientId,
    callId,
    channel,
    direction: "outbound",
    body,
    waMessageId: ids.waMessageId ?? null,
    gmailThreadId: ids.gmailThreadId ?? null,
  });
}

// ── Retry delay calculation ──

const RETRY_DELAYS_MS = [
  24 * 60 * 60 * 1000, // attempt 1 → 24h
  32 * 60 * 60 * 1000, // attempt 2 → 32h
];

export function getRetryDelay(attemptNumber: number): number {
  if (attemptNumber < 1 || attemptNumber > RETRY_DELAYS_MS.length) {
    throw new Error(`No retry delay for attempt ${attemptNumber} — lead should be marked lost`);
  }
  return RETRY_DELAYS_MS[attemptNumber - 1];
}

// ── Schedule retry (insert into retryQueue + update clientLeads) ──

async function scheduleRetry(
  leadId: string,
  clientId: string,
  callId: string,
  attemptCount: number,
  reason: string,
  ctx: AgentContext,
): Promise<Date> {
  const delayMs = getRetryDelay(attemptCount);
  const nextRetryAt = new Date(Date.now() + delayMs);

  await db.insert(schema.retryQueue).values({
    id: randomUUID(),
    leadId,
    clientId,
    callId,
    attempt: attemptCount,
    reason,
    nextAttemptAt: nextRetryAt,
    maxAttempts: 3,
    status: "pending",
  });

  await db
    .update(schema.clientLeads)
    .set({
      attemptCount,
      lastCallAt: new Date(),
      nextRetryAt,
    })
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

  ctx.bus.publish({
    type: "retry.scheduled",
    leadId,
    clientId,
    nextAttemptAt: nextRetryAt.toISOString(),
  });

  return nextRetryAt;
}

// ── Send info (WA details + Gmail) ──

async function sendInfo(
  leadId: string,
  clientId: string,
  callId: string,
  lead: { phoneE164: string | null; firstName: string | null; company: string | null; email: string | null },
  ctx: AgentContext,
): Promise<number> {
  let messagesSent = 0;

  const waId = await sendWhatsApp(
    lead.phoneE164,
    "info_send",
    [lead.firstName || "there", lead.company || "your team"],
  );
  if (waId) messagesSent++;

  await storeMessage(leadId, clientId, callId, "whatsapp", `Info sent for ${lead.company || "company"}`, {
    waMessageId: waId,
  });

  if (lead.email) {
    const gmailId = await sendGmail(
      lead.email,
      "AarambhAI — Following up on our conversation",
      `Hi ${lead.firstName || ""},\n\nThanks for your interest. Here's the information we discussed.\n\nBook a meeting: ${process.env.NEXT_PUBLIC_APP_URL}/book/${leadId}`,
    );
    if (gmailId) messagesSent++;

    await storeMessage(leadId, clientId, callId, "gmail", `Email sent to ${lead.email}`, {
      gmailThreadId: gmailId,
    });
  }

  return messagesSent;
}

// ── Main router ──

export async function routeOutcome(
  leadId: string,
  clientId: string,
  callId: string,
  outcome: CallOutcome,
  ctx: AgentContext,
): Promise<OutcomeResult> {
  ctx.log("outcome-router", { outcome });

  // Fetch lead for contact details
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) throw new Error(`Lead ${leadId} not found`);

  // Fetch current clientLeads row for attemptCount
  const [cl] = await db
    .select()
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)))
    .limit(1);

  const currentAttempt = (cl?.attemptCount ?? 0) + 1;

  switch (outcome) {
    // ── 0. INITIATED (call submitted, provider outcome pending) ──
    // The real outcome arrives asynchronously via the Vobiz status/hangup
    // callback, which re-enters this router with the terminal outcome.
    // Do nothing here — never fabricate an outcome, never mark lost.
    case "initiated": {
      ctx.log("outcome-router: call in flight, awaiting provider callback", { leadId, callId });
      return { nextAction: "wait_reply", nudgeSent: true };
    }

    // ── 1. INTERESTED ──
    case "interested": {
      const messagesSent = await sendInfo(leadId, clientId, callId, lead, ctx);

      await db
        .update(schema.clientLeads)
        .set({ status: "contacted", lastCallAt: new Date() })
        .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

      ctx.bus.publish({ type: "reply.interested", leadId, clientId });

      createNotificationForTenant(db, {
        tenantId: clientId,
        type: "interested",
        title: "Lead Interested",
        message: formatNotificationMessage("interested", {
          leadName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || undefined,
          company: lead.company ?? undefined,
        }),
        leadId,
        callId,
      }).catch(() => {});

      return { nextAction: "wait_reply", nudgeSent: true, messagesSent };
    }

    // ── 2. NOT_INTERESTED ──
    case "not_interested": {
      await db
        .update(schema.clientLeads)
        .set({ status: "lost", lostAt: new Date(), lastCallAt: new Date() })
        .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

      ctx.bus.publish({ type: "reply.not_interested", leadId, clientId });

      return { nextAction: "lost", nudgeSent: false };
    }

    // ── 3. NO_ANSWER ──
    case "no_answer": {
      await sendWhatsApp(lead.phoneE164, "tried_reaching", [lead.firstName || "there"]);

      await storeMessage(leadId, clientId, callId, "whatsapp", "Tried reaching — will retry", {});

      if (currentAttempt >= 3) {
        await db
          .update(schema.clientLeads)
          .set({ status: "lost", lostAt: new Date(), lastCallAt: new Date(), attemptCount: currentAttempt })
          .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

        return { nextAction: "lost", nudgeSent: false };
      }

      const retryAt = await scheduleRetry(leadId, clientId, callId, currentAttempt, "no_answer", ctx);

      return { nextAction: "retry", nudgeSent: false, retryAt };
    }

    // ── 4. BUSY ──
    case "busy": {
      await sendWhatsApp(lead.phoneE164, "tried_reaching", [lead.firstName || "there"]);

      await storeMessage(leadId, clientId, callId, "whatsapp", "Line busy — will retry", {});

      if (currentAttempt >= 3) {
        await db
          .update(schema.clientLeads)
          .set({ status: "lost", lostAt: new Date(), lastCallAt: new Date(), attemptCount: currentAttempt })
          .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

        return { nextAction: "lost", nudgeSent: false };
      }

      const retryAt = await scheduleRetry(leadId, clientId, callId, currentAttempt, "busy", ctx);

      return { nextAction: "retry", nudgeSent: false, retryAt };
    }

    // ── 5. FAILED ──
    case "failed": {
      await sendWhatsApp(lead.phoneE164, "tried_reaching", [lead.firstName || "there"]);

      await storeMessage(leadId, clientId, callId, "whatsapp", "Call failed — will retry", {});

      if (currentAttempt >= 3) {
        await db
          .update(schema.clientLeads)
          .set({ status: "lost", lostAt: new Date(), lastCallAt: new Date(), attemptCount: currentAttempt })
          .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

        return { nextAction: "lost", nudgeSent: false };
      }

      const retryAt = await scheduleRetry(leadId, clientId, callId, currentAttempt, "failed", ctx);

      return { nextAction: "retry", nudgeSent: false, retryAt };
    }

    // ── 6. PICKED_NO_RESPONSE ──
    case "picked_no_response": {
      const messagesSent = await sendInfo(leadId, clientId, callId, lead, ctx);

      await db
        .update(schema.clientLeads)
        .set({ status: "contacted", lastCallAt: new Date() })
        .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

      ctx.bus.publish({ type: "reply.neutral", leadId, clientId });

      return { nextAction: "wait_reply", nudgeSent: true, messagesSent };
    }

    // ── 7. BOOKED ──
    case "booked": {
      const waId = await sendWhatsApp(lead.phoneE164, "meeting_link", [lead.firstName || "there"]);

      await storeMessage(leadId, clientId, callId, "whatsapp", "Meeting booked — confirmation sent", {
        waMessageId: waId,
      });

      await db
        .update(schema.clientLeads)
        .set({ status: "qualified", lastCallAt: new Date() })
        .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

      ctx.bus.publish({ type: "meeting.booked", leadId, clientId });

      createNotificationForTenant(db, {
        tenantId: clientId,
        type: "meeting_booked",
        title: "Meeting Booked",
        message: formatNotificationMessage("meeting_booked", {
          leadName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || undefined,
          company: lead.company ?? undefined,
        }),
        leadId,
        callId,
      }).catch(() => {});

      return { nextAction: "confirm_booking", nudgeSent: true, messagesSent: 1 };
    }

    default: {
      ctx.log("outcome-router unknown outcome", { outcome });
      return { nextAction: "lost", nudgeSent: false };
    }
  }
}
