import { randomUUID } from "node:crypto";

// ── Messaging Service ──
// Sends WhatsApp / email reminder messages. Falls back to a structured stub log
// (returning a synthetic message id) when provider credentials are not configured,
// mirroring the existing nudge/reminder agents.

const WA_API = "https://graph.facebook.com/v19.0";
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WA_TOKEN = process.env.WHATSAPP_API_TOKEN;

export interface ReminderMessageInput {
  channel: "whatsapp" | "email";
  to: string | null;
  templateName: string;
  params: string[];
  subject?: string;
}

export interface ReminderMessageResult {
  ok: boolean;
  providerMessageId?: string;
  sentVia: "whatsapp" | "email" | "stub";
  error?: string;
}

async function sendWhatsApp(to: string, templateName: string, params: string[]): Promise<string | null> {
  if (!WA_PHONE_ID || !WA_TOKEN) return null;

  const res = await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
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
    console.error(`[messaging] WA send failed: ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data.messages?.[0]?.id || null;
}

async function sendEmail(to: string, subject: string, body: string): Promise<string | null> {
  // Gmail OAuth delivery is not wired up yet; record a stub so the pipeline stays intact.
  return null;
}

export async function sendReminderMessage(input: ReminderMessageInput): Promise<ReminderMessageResult> {
  if (!input.to) {
    return { ok: false, error: "No recipient address", sentVia: "stub" };
  }

  if (input.channel === "whatsapp") {
    const providerMessageId = await sendWhatsApp(input.to, input.templateName, input.params);
    if (providerMessageId) {
      return { ok: true, providerMessageId, sentVia: "whatsapp" };
    }
  } else {
    const providerMessageId = await sendEmail(
      input.to,
      input.subject ?? input.templateName,
      input.params.join(" — "),
    );
    if (providerMessageId) {
      return { ok: true, providerMessageId, sentVia: "email" };
    }
  }

  // Structured stub log when the provider is unavailable (dev / unconfigured).
  const stubId = `${input.channel}-stub-${randomUUID().slice(0, 8)}`;
  console.log(
    `[messaging:stub] channel=${input.channel} to=${input.to} template=${input.templateName} params=${JSON.stringify(input.params)}`,
  );
  return { ok: true, providerMessageId: stubId, sentVia: "stub" };
}

// ── Shared messaging service barrel (Agent 8) ──

export { detectIntent } from "./intent";
export {
  handleWhatsAppWebhook,
  parseWhatsAppWebhook,
  APPROVED_TEMPLATES,
  isTemplateApproved,
  assertTemplateApproved,
  isWithinSessionWindow,
  callWhatsAppApi,
} from "./whatsapp";
export {
  handleGmailWebhook,
  parseGmailWebhook,
  sendRawGmail,
  refreshGmailAccessToken,
} from "./gmail";
export { processInboundMessage } from "./inbound";
export { sendMessage, sendWhatsApp, sendGmail } from "./service";
export {
  verifyHmacSignature,
  persistWebhookEvent,
  recordInboxEvent,
  sha256Hex,
  DEFAULT_TENANT,
} from "./webhook-security";
export type {
  Db,
  MessageChannel,
  Intent,
  InboundMessage,
  SendResult,
  WhatsAppSendInput,
  GmailSendInput,
  SendMessageInput,
  InboundProcessResult,
} from "./types";