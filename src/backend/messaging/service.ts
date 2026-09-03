import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import {
  assertTemplateApproved,
  callWhatsAppApi,
  isWithinSessionWindow,
} from "./whatsapp";
import { sendRawGmail } from "./gmail";
import type {
  Db,
  GmailSendInput,
  MessageChannel,
  SendMessageInput,
  SendResult,
  WhatsAppSendInput,
} from "./types";

// ── Lead resolution ──

async function resolveLeadForSend(
  db: Db,
  opts: { leadId?: string; clientId?: string; to: string; byEmail: boolean },
): Promise<{ leadId?: string; clientId?: string }> {
  let lead: { id: string } | undefined;
  if (opts.leadId) {
    const [row] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, opts.leadId))
      .limit(1);
    lead = row;
  } else {
    const [row] = await db
      .select()
      .from(schema.leads)
      .where(opts.byEmail ? eq(schema.leads.email, opts.to) : eq(schema.leads.phoneE164, opts.to))
      .limit(1);
    lead = row;
  }

  let clientId = opts.clientId;
  if (lead && !clientId) {
    const [cl] = await db
      .select()
      .from(schema.clientLeads)
      .where(eq(schema.clientLeads.leadId, lead.id))
      .limit(1);
    clientId = cl?.clientId;
  }

  return { leadId: lead?.id, clientId };
}

async function findPersistedMessage(
  db: Db,
  idempotencyKey: string,
): Promise<{ id: string; providerId?: string | null; threadId?: string | null } | null> {
  const [row] = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    providerId: row.waMessageId ?? row.gmailThreadId,
    threadId: row.gmailThreadId,
  };
}

// ── WhatsApp ──

/**
 * Sends an approved WhatsApp template message via the Graph API v19.0.
 * Persists a message record and dedupes by idempotency key.
 */
export async function sendWhatsApp(
  db: Db,
  input: WhatsAppSendInput,
): Promise<SendResult> {
  assertTemplateApproved(input.templateName);

  const resolved = await resolveLeadForSend(db, {
    leadId: input.leadId,
    clientId: input.clientId,
    to: input.to,
    byEmail: false,
  });

  const idempotencyKey = input.idempotencyKey ?? `wa:${randomUUID()}`;

  const existing = await findPersistedMessage(db, idempotencyKey);
  if (existing) {
    return { ok: true, idempotent: true, providerId: existing.providerId ?? undefined, messageId: existing.id };
  }

  const providerId = await callWhatsAppApi(input.to, input.templateName, input.params);
  if (!providerId) return { ok: false };

  if (resolved.leadId && resolved.clientId) {
    const inserted = await db
      .insert(schema.messages)
      .values({
        id: randomUUID(),
        leadId: resolved.leadId,
        clientId: resolved.clientId,
        callId: input.callId ?? null,
        channel: "whatsapp",
        direction: "outbound",
        body: `Sent template ${input.templateName} to ${input.to}`,
        waMessageId: providerId,
        templateName: input.templateName,
        idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: schema.messages.id });

    if (inserted.length === 0) {
      const dup = await findPersistedMessage(db, idempotencyKey);
      if (dup) {
        return { ok: true, idempotent: true, providerId: dup.providerId ?? undefined, messageId: dup.id };
      }
    }
    return { ok: true, providerId, messageId: inserted[0]?.id };
  }

  return { ok: true, providerId };
}

// ── Gmail ──

/**
 * Sends an email via the Gmail API, maintains threading via
 * References/In-Reply-To when a threadId is supplied, and persists a record.
 */
export async function sendGmail(
  db: Db,
  input: GmailSendInput,
): Promise<SendResult> {
  const resolved = await resolveLeadForSend(db, {
    leadId: input.leadId,
    clientId: input.clientId,
    to: input.to,
    byEmail: true,
  });

  const idempotencyKey = input.idempotencyKey ?? `gmail:${randomUUID()}`;

  const existing = await findPersistedMessage(db, idempotencyKey);
  if (existing) {
    return {
      ok: true,
      idempotent: true,
      providerId: existing.providerId ?? undefined,
      threadId: existing.threadId ?? undefined,
      messageId: existing.id,
    };
  }

  const sent = await sendRawGmail({
    to: input.to,
    subject: input.subject,
    htmlBody: input.body,
    threadId: input.threadId,
  });
  if (!sent) return { ok: false };

  if (resolved.leadId && resolved.clientId) {
    const inserted = await db
      .insert(schema.messages)
      .values({
        id: randomUUID(),
        leadId: resolved.leadId,
        clientId: resolved.clientId,
        callId: input.callId ?? null,
        channel: "gmail",
        direction: "outbound",
        body: `Email "${input.subject}" sent to ${input.to}`,
        gmailThreadId: sent.threadId,
        templateName: null,
        idempotencyKey,
      })
      .onConflictDoNothing()
      .returning({ id: schema.messages.id });

    if (inserted.length === 0) {
      const dup = await findPersistedMessage(db, idempotencyKey);
      if (dup) {
        return {
          ok: true,
          idempotent: true,
          providerId: dup.providerId ?? undefined,
          threadId: dup.threadId ?? undefined,
          messageId: dup.id,
        };
      }
    }
    return { ok: true, providerId: sent.id, threadId: sent.threadId, messageId: inserted[0]?.id };
  }

  return { ok: true, providerId: sent.id, threadId: sent.threadId };
}

// ── Dispatcher ──

export async function sendMessage(
  db: Db,
  channel: MessageChannel,
  payload: SendMessageInput,
): Promise<SendResult> {
  if (channel === "whatsapp") {
    return sendWhatsApp(db, payload as WhatsAppSendInput);
  }
  if (channel === "gmail") {
    return sendGmail(db, payload as GmailSendInput);
  }
  throw new Error(`Unsupported messaging channel: ${String(channel)}`);
}

// Re-export for convenience so callers can enforce the session window for
// free-form messages without importing the adapter directly.
export { isWithinSessionWindow, assertTemplateApproved };