import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { processInboundMessage } from "./inbound";
import { recordInboxEvent, sha256Hex, DEFAULT_TENANT } from "./webhook-security";
import type { Db, InboundMessage } from "./types";

export const WHATSAPP_API_VERSION = "v19.0";
export const WHATSAPP_API = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

// ── Template compliance ──
// Only names that exist in the WhatsApp account's approved template catalogue
// may be used for outbound template messages. Templates used by nudge /
// reminder / outcome-router (both v1 and legacy names) are whitelisted.
export const APPROVED_TEMPLATES = new Set<string>([
  "tried_reaching",
  "tried_reaching_v1",
  "info_send",
  "info_send_v1",
  "meeting_link",
  "meeting_link_v1",
  "follow_up",
  "follow_up_v1",
  "meeting_reminder_day_before",
  "meeting_reminder_day_of",
]);

export function isTemplateApproved(templateName: string): boolean {
  return APPROVED_TEMPLATES.has(templateName);
}

export function assertTemplateApproved(templateName: string): void {
  if (!isTemplateApproved(templateName)) {
    throw new Error(`Template "${templateName}" is not approved for outbound WhatsApp`);
  }
}

// ── Session window ──
// Free-form (non-template) messages may only be sent within 24h of the last
// user-initiated message. Template messages are exempt.
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function isWithinSessionWindow(
  db: Db,
  opts: { leadId: string; clientId: string; now?: Date },
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const [last] = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.leadId, opts.leadId),
        eq(schema.messages.clientId, opts.clientId),
        eq(schema.messages.direction, "inbound"),
      ),
    )
    .orderBy(desc(schema.messages.sentAt))
    .limit(1);

  if (!last?.sentAt) return false;
  return now.getTime() - last.sentAt.getTime() <= SESSION_WINDOW_MS;
}

// ── Low-level Graph API call ──
export async function callWhatsAppApi(
  to: string,
  templateName: string,
  params: string[],
): Promise<string | null> {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token = process.env.WHATSAPP_API_TOKEN;
  if (!phoneId || !token) {
    console.log(`[WA-STUB] To: ${to}, Template: ${templateName}`);
    return `wa-stub-${randomUUID().slice(0, 8)}`;
  }

  const res = await fetch(`${WHATSAPP_API}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }],
      },
    }),
  });

  if (!res.ok) {
    console.error(`[WA] send failed: ${res.status} ${res.statusText}`);
    return null;
  }
  const data = (await res.json()) as { messages?: Array<{ id?: string }> };
  return data.messages?.[0]?.id ?? null;
}

// ── Inbound parsing ──

interface WhatsAppWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        messaging_product?: string;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
        }>;
        statuses?: unknown[];
      };
    }>;
  }>;
}

export function parseWhatsAppWebhook(body: unknown): InboundMessage[] {
  if (!body || typeof body !== "object") return [];

  // Legacy route payload: { leadId, clientId, messageBody, timestamp }
  const legacy = body as Record<string, unknown>;
  if (typeof legacy.messageBody === "string") {
    return [
      {
        messageId: `legacy:${sha256Hex(JSON.stringify(body))}`,
        leadId: typeof legacy.leadId === "string" ? legacy.leadId : undefined,
        clientId: typeof legacy.clientId === "string" ? legacy.clientId : undefined,
        from: typeof legacy.leadId === "string" ? legacy.leadId : undefined,
        body: legacy.messageBody,
        receivedAt: legacy.timestamp ? new Date(String(legacy.timestamp)) : new Date(),
      },
    ];
  }

  const webhook = body as WhatsAppWebhookBody;
  const messages: InboundMessage[] = [];

  for (const entry of webhook.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const msg of value?.messages ?? []) {
        if (!msg.id) continue;
        // Ignore non-text payloads (audio/image/document) — no intent to parse.
        if (msg.type && msg.type !== "text") continue;
        messages.push({
          messageId: msg.id,
          from: msg.from,
          body: msg.text?.body ?? "",
          receivedAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date(),
        });
      }
    }
  }

  return messages;
}

async function resolveLeadByPhone(
  db: Db,
  phone: string | undefined,
): Promise<{ leadId: string; clientId: string } | null> {
  if (!phone) return null;
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.phoneE164, phone))
    .limit(1);
  if (!lead) return null;

  const [cl] = await db
    .select()
    .from(schema.clientLeads)
    .where(eq(schema.clientLeads.leadId, lead.id))
    .limit(1);
  if (!cl) return null;

  return { leadId: lead.id, clientId: cl.clientId };
}

// ── Webhook handler ──

export interface WhatsAppWebhookResult {
  processed: number;
  duplicates: number;
  ignored: number;
}

/**
 * Parses a Meta WhatsApp webhook payload, dedupes by provider message id,
 * resolves the lead, persists the thread and routes to the intent handler.
 */
export async function handleWhatsAppWebhook(
  db: Db,
  body: unknown,
): Promise<WhatsAppWebhookResult> {
  const parsed = parseWhatsAppWebhook(body);
  let processed = 0;
  let duplicates = 0;
  let ignored = 0;

  for (const msg of parsed) {
    const resolved = msg.leadId && msg.clientId
      ? { leadId: msg.leadId, clientId: msg.clientId }
      : await resolveLeadByPhone(db, msg.from);

    const tenantId = resolved?.clientId ?? DEFAULT_TENANT;

    // Dedupe by provider message id — safe to re-process different messages.
    const isNew = await recordInboxEvent(db, {
      tenantId,
      source: "whatsapp",
      externalId: msg.messageId,
      eventType: "message.inbound",
      payload: { from: msg.from, body: msg.body },
    });
    if (!isNew) {
      duplicates++;
      continue;
    }

    if (!resolved) {
      ignored++;
      continue;
    }

    // Persist the thread on the shared messages table.
    await db.insert(schema.messages).values({
      id: randomUUID(),
      leadId: resolved.leadId,
      clientId: resolved.clientId,
      channel: "whatsapp",
      direction: "inbound",
      body: msg.body,
      waMessageId: msg.messageId,
      sentAt: msg.receivedAt ?? new Date(),
    });

    await processInboundMessage(db, {
      channel: "whatsapp",
      message: { ...msg, leadId: resolved.leadId, clientId: resolved.clientId, tenantId },
    });

    processed++;
  }

  return { processed, duplicates, ignored };
}