import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { detectIntent } from "./intent";
import { generateReply } from "./conversational-ai";
import { offerSlots } from "../calendar/booking";
import { recordInboxEvent } from "./webhook-security";
import * as gmail from "../integrations/composio-gmail";
import type { Db, Intent } from "./types";

const SOURCE = "gmail-agent";

export interface EmailAgentResult {
  threadId: string;
  intent: Intent;
  replied: boolean;
  reply?: string;
}

export interface StoreMessageInput {
  leadId: string;
  clientId: string;
  channel: string;
  direction: "inbound" | "outbound";
  body: string;
  gmailThreadId: string;
}

async function storeMessage(db: Db, input: StoreMessageInput): Promise<void> {
  await db.insert(schema.messages).values({
    id: randomUUID(),
    leadId: input.leadId,
    clientId: input.clientId,
    channel: input.channel,
    direction: input.direction,
    body: input.body,
    gmailThreadId: input.gmailThreadId,
  });
}

async function resolveLead(
  db: Db,
  email: string | undefined,
  tenantId: string
): Promise<{ leadId: string; clientId: string; firstName: string | null } | null> {
  if (!email) return null;
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.email, email))
    .limit(1);
  if (!lead) return null;

  const [cl] = await db
    .select()
    .from(schema.clientLeads)
    .where(
      and(
        eq(schema.clientLeads.leadId, lead.id),
        eq(schema.clientLeads.clientId, tenantId),
      )
    )
    .limit(1);

  return {
    leadId: lead.id,
    clientId: cl?.clientId ?? tenantId,
    firstName: lead.firstName,
  };
}

async function markDnc(
  db: Db,
  lead: { leadId: string; clientId: string }
): Promise<void> {
  await db
    .update(schema.leads)
    .set({ dnc: 1 })
    .where(eq(schema.leads.id, lead.leadId));
  await db
    .update(schema.clientLeads)
    .set({ status: "dnc", nextRetryAt: null })
    .where(
      and(
        eq(schema.clientLeads.leadId, lead.leadId),
        eq(schema.clientLeads.clientId, lead.clientId),
      )
    );
}

function formatSlots(slots: Array<{ start: Date; end: Date }>): string {
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
}

async function safeOfferSlots(
  db: Db,
  tenantId: string,
  leadId: string
): Promise<string> {
  try {
    const slots = await offerSlots(db, tenantId, leadId);
    if (slots.length === 0) return "";
    return formatSlots(slots);
  } catch {
    return "";
  }
}

async function composeReply(
  db: Db,
  tenantId: string,
  lead: { leadId: string; clientId: string; firstName: string | null },
  intent: Intent,
  inbound: gmail.GmailMessage
): Promise<string | null> {
  const leadName = lead.firstName || "there";

  if (intent === "dnc") {
    return null;
  }

  if (intent === "meeting_request") {
    const slots = await safeOfferSlots(db, tenantId, lead.leadId);
    const slotMessage = slots.length > 0 ? `\n\nHere are some available time slots:\n${slots}` : "";
    return `Great to hear you'd like to schedule a meeting, ${leadName}!${slotMessage}\n\nJust reply with the slot that works best for you, or let me know your preferred time and I'll get it set up.`;
  }

  if (intent === "interested") {
    return `Thanks for your interest, ${leadName}! I'd love to walk you through how we can help and share more details in a quick meeting. Would you like to schedule a short call? Just let me know a time that works for you.`;
  }

  try {
    const result = await generateReply(db, {
      tenantId,
      leadId: lead.leadId,
      clientId: lead.clientId,
      channel: "gmail",
      incomingMessage: inbound.body ?? inbound.snippet ?? "",
    });
    return result.reply;
  } catch (err) {
    console.error(`[email-agent] conversational reply failed for lead ${lead.leadId}:`, err);
    return null;
  }
}

// Picks the most recent message in a thread that came from the customer (i.e.
// not sent by us). Assumes composio returns messages in thread order.
function pickInbound(messages: gmail.GmailMessage[]): gmail.GmailMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const from = (message.from ?? "").toLowerCase();
    const to = (message.to ?? "").toLowerCase();
    if (from.length > 0 && to !== "me" && !from.includes("mailer@")) {
      return message;
    }
  }
  return null;
}

export async function replyToThread(
  db: Db,
  tenantId: string,
  threadId: string
): Promise<EmailAgentResult | null> {
  let messages: gmail.GmailMessage[];
  try {
    messages = await gmail.getThreadMessages(tenantId, threadId);
  } catch (err) {
    console.error(`[email-agent] failed to fetch thread ${threadId}:`, err);
    return null;
  }

  const inbound = pickInbound(messages);
  if (!inbound) return null;
  const body = inbound.body ?? inbound.snippet ?? "";
  if (!body.trim()) return null;

  const externalId = inbound.id || threadId;
  const isNew = await recordInboxEvent(db, {
    tenantId,
    source: SOURCE,
    externalId,
    eventType: "message.inbound",
    payload: { threadId, from: inbound.from, subject: inbound.subject, body },
  });
  if (!isNew) {
    return { threadId, intent: "neutral", replied: false };
  }

  const lead = await resolveLead(db, inbound.from, tenantId);
  if (!lead) {
    return { threadId, intent: "neutral", replied: false };
  }

  await storeMessage(db, {
    leadId: lead.leadId,
    clientId: lead.clientId,
    channel: "gmail",
    direction: "inbound",
    body,
    gmailThreadId: threadId,
  });

  const intent = detectIntent(body);

  if (intent === "dnc") {
    await markDnc(db, lead);
    return { threadId, intent, replied: false };
  }

  const reply = await composeReply(db, tenantId, lead, intent, inbound);
  if (!reply) {
    return { threadId, intent, replied: false };
  }

  const from = inbound.from ? parseEmail(inbound.from) : undefined;
  if (!from) {
    return { threadId, intent, replied: false };
  }

  let sent: gmail.GmailSendResult | null = null;
  try {
    sent = await gmail.sendEmail(tenantId, {
      to: from,
      subject: inbound.subject
        ? `Re: ${inbound.subject.replace(/^(Re:|Fwd:)\s*/i, "")}`
        : "Re: Your message",
      body: reply,
      inReplyToThreadId: threadId,
    });
  } catch (err) {
    console.error(`[email-agent] send failed for thread ${threadId}:`, err);
  }
  if (!sent) {
    return { threadId, intent, replied: false };
  }

  await storeMessage(db, {
    leadId: lead.leadId,
    clientId: lead.clientId,
    channel: "gmail",
    direction: "outbound",
    body: reply,
    gmailThreadId: sent.threadId,
  });

  return { threadId, intent, replied: true, reply };
}

function parseEmail(value: string): string | undefined {
  const match = value.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  return match ? match[0] : undefined;
}

export async function pollAndReply(
  db: Db,
  tenantId: string,
  opts: { query?: string; maxResults?: number } = {}
): Promise<{ replied: number; scanned: number }> {
  const threads = await gmail.listThreads(
    tenantId,
    opts.query ?? "is:unread",
    opts.maxResults ?? 20
  );

  let replied = 0;
  for (const thread of threads) {
    const result = await replyToThread(db, tenantId, thread.id);
    if (result?.replied) replied++;
  }

  return { replied, scanned: threads.length };
}

export async function handleGmailPushNotification(
  db: Db,
  tenantId: string,
  _historyBody: unknown
): Promise<{ replied: number }> {
  const { replied } = await pollAndReply(db, tenantId, { query: "is:inbox" });
  return { replied };
}

export async function sendManualReply(
  db: Db,
  tenantId: string,
  threadId: string,
  body: string
): Promise<EmailAgentResult | null> {
  let messages: gmail.GmailMessage[];
  try {
    messages = await gmail.getThreadMessages(tenantId, threadId);
  } catch (err) {
    console.error(`[email-agent] failed to fetch thread ${threadId}:`, err);
    return null;
  }

  const inbound = pickInbound(messages);
  if (!inbound) return null;
  const from = inbound.from ? parseEmail(inbound.from) : undefined;
  if (!from) return null;

  const lead = await resolveLead(db, from, tenantId);
  const subject = inbound.subject
    ? `Re: ${inbound.subject.replace(/^(Re:|Fwd:)\s*/i, "")}`
    : "Re: Your message";

  let sent: gmail.GmailSendResult | null = null;
  try {
    sent = await gmail.sendEmail(tenantId, {
      to: from,
      subject,
      body,
      inReplyToThreadId: threadId,
    });
  } catch (err) {
    console.error(`[email-agent] send failed for thread ${threadId}:`, err);
  }
  if (!sent) return null;

  if (lead) {
    await storeMessage(db, {
      leadId: lead.leadId,
      clientId: lead.clientId,
      channel: "gmail",
      direction: "outbound",
      body,
      gmailThreadId: sent.threadId,
    });
  }

  return { threadId, intent: "neutral", replied: true, reply: body };
}