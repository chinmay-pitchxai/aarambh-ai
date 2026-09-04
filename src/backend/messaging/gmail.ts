import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import { processInboundMessage } from "./inbound";
import { recordInboxEvent, sha256Hex, DEFAULT_TENANT } from "./webhook-security";
import type { Db, InboundMessage } from "./types";

const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

// ── OAuth + raw send ──

export async function refreshGmailAccessToken(): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Gmail OAuth env vars missing");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error(`Gmail token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Gmail token refresh returned no access token");
  return data.access_token;
}

export interface GmailSendRequest {
  to: string;
  subject: string;
  htmlBody: string;
  /** Replying inside an existing thread: emits In-Reply-To/References headers. */
  threadId?: string;
}

export interface GmailSendResponse {
  id: string;
  threadId: string;
}

export async function sendRawGmail(input: GmailSendRequest): Promise<GmailSendResponse | null> {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.log(`[GMAIL-STUB] To: ${input.to}, Subject: ${input.subject}`);
    const stub = `gmail-stub-${randomUUID().slice(0, 8)}`;
    return { id: stub, threadId: input.threadId ?? stub };
  }

  try {
    const accessToken = await refreshGmailAccessToken();

    const headers = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
    ];
    // Maintain threading via References/In-Reply-To so replies stay in one thread.
    if (input.threadId) {
      headers.push(`In-Reply-To: <${input.threadId}>`);
      headers.push(`References: <${input.threadId}>`);
    }

    const mimeMessage = [...headers, "", input.htmlBody].join("\r\n");
    const encodedMessage = Buffer.from(mimeMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedMessage }),
    });

    if (!res.ok) {
      console.error(`[GMAIL] send failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = (await res.json()) as { id?: string; threadId?: string };
    if (!data.id) return null;
    return { id: data.id, threadId: data.threadId ?? input.threadId ?? data.id };
  } catch (err) {
    console.error("[GMAIL] send error:", err);
    return null;
  }
}

/**
 * Sends an outbound reply, preferring the Composio Gmail connected account when
 * the legacy OAuth env vars are absent (otherwise falls back to the legacy path
 * or its stub/log behaviour). Requires the reply target's tenant context.
 */
export async function sendGmailReply(
  tenantId: string,
  input: { from: string; subject: string; reply: string; threadId?: string },
): Promise<GmailSendResponse | null> {
  const hasLegacy = Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN);

  if (!hasLegacy) {
    try {
      const { getConnection, sendEmail } = await import("../integrations/composio-gmail");
      const connectionId = await getConnection(tenantId);
      if (connectionId) {
        const sent = await sendEmail(tenantId, {
          to: input.from,
          subject: input.subject,
          body: input.reply,
          inReplyToThreadId: input.threadId,
        });
        if (sent) {
          return { id: sent.id, threadId: sent.threadId };
        }
      }
    } catch (err) {
      console.error("[GMAIL] composio send error:", err);
    }
  }

  return sendRawGmail({
    to: input.from,
    subject: input.subject,
    htmlBody: `<p>${input.reply.replace(/\n/g, "<br>")}</p>`,
    threadId: input.threadId,
  });
}

// ── Inbound parsing ──

interface PubSubPush {
  message?: { data?: string };
}

function parsePubSub(body: unknown): InboundMessage | null {
  const push = body as PubSubPush;
  if (!push.message || typeof push.message !== "object" || typeof push.message.data !== "string") {
    return null;
  }

  let decoded: { emailAddress?: string; historyId?: string };
  try {
    decoded = JSON.parse(Buffer.from(push.message.data, "base64url").toString("utf8")) as {
      emailAddress?: string;
      historyId?: string;
    };
  } catch {
    return null;
  }

  // A pub/sub push only carries emailAddress + historyId — the actual message
  // must be pulled via the Gmail API. Treat as a dedupe-only marker.
  if (!decoded.historyId) return null;
  return {
    messageId: `history:${decoded.historyId}`,
    from: decoded.emailAddress,
    body: "",
  };
}

function parseDecodedMessage(body: unknown): InboundMessage | null {
  const raw = body as Record<string, unknown>;
  const messageId = typeof raw.messageId === "string" ? raw.messageId : undefined;

  // Legacy route payload: { leadId, clientId, subject, body } (no messageId).
  const leadId = typeof raw.leadId === "string" ? raw.leadId : undefined;
  const clientId = typeof raw.clientId === "string" ? raw.clientId : undefined;
  const subject = typeof raw.subject === "string" ? raw.subject : undefined;
  const content = typeof raw.body === "string" ? raw.body : typeof raw.text === "string" ? raw.text : "";

  if (!messageId && !(leadId && content)) return null;

  return {
    messageId: messageId ?? `legacy:${sha256Hex(JSON.stringify(body))}`,
    threadId: typeof raw.threadId === "string" ? raw.threadId : undefined,
    leadId,
    clientId,
    from: typeof raw.from === "string" ? raw.from : undefined,
    to: typeof raw.to === "string" ? raw.to : undefined,
    subject,
    body: content,
    references: typeof raw.references === "string" ? raw.references : undefined,
    inReplyTo: typeof raw.inReplyTo === "string" ? raw.inReplyTo : undefined,
    receivedAt: raw.timestamp ? new Date(String(raw.timestamp)) : new Date(),
  };
}

export function parseGmailWebhook(body: unknown): InboundMessage | null {
  if (!body || typeof body !== "object") return null;
  return parsePubSub(body) ?? parseDecodedMessage(body);
}

async function resolveLeadByEmail(
  db: Db,
  email: string | undefined,
): Promise<{ leadId: string; clientId: string } | null> {
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
    .where(eq(schema.clientLeads.leadId, lead.id))
    .limit(1);
  if (!cl) return null;

  return { leadId: lead.id, clientId: cl.clientId };
}

// ── Webhook handler ──

export interface GmailWebhookResult {
  processed: number;
  duplicates: number;
  skipped: number;
}

/**
 * Parses a Gmail push (pub/sub or decoded message), dedupes by provider message
 * id, resolves the lead, persists the thread and routes to the intent handler.
 */
export async function handleGmailWebhook(
  db: Db,
  body: unknown,
): Promise<GmailWebhookResult> {
  const parsed = parseGmailWebhook(body);

  // Nothing to process — either a pub/sub history ping (content must be pulled
  // via the API) or a malformed payload.
  if (!parsed || !parsed.body) {
    return { processed: 0, duplicates: 0, skipped: 1 };
  }

  const resolved = parsed.leadId && parsed.clientId
    ? { leadId: parsed.leadId, clientId: parsed.clientId }
    : await resolveLeadByEmail(db, parsed.from);

  const tenantId = resolved?.clientId ?? DEFAULT_TENANT;

  const isNew = await recordInboxEvent(db, {
    tenantId,
    source: "gmail",
    externalId: parsed.messageId,
    eventType: "message.inbound",
    payload: { from: parsed.from, subject: parsed.subject, body: parsed.body },
  });
  if (!isNew) {
    return { processed: 0, duplicates: 1, skipped: 0 };
  }

  if (!resolved) {
    return { processed: 0, duplicates: 0, skipped: 1 };
  }

  // Persist the inbound message; the Gmail thread id keeps replies threaded together.
  await db.insert(schema.messages).values({
    id: randomUUID(),
    leadId: resolved.leadId,
    clientId: resolved.clientId,
    channel: "gmail",
    direction: "inbound",
    body: parsed.subject ? `[${parsed.subject}] ${parsed.body}` : parsed.body,
    gmailThreadId: parsed.threadId ?? parsed.messageId,
    sentAt: parsed.receivedAt ?? new Date(),
  });

  const result = await processInboundMessage(db, {
    channel: "gmail",
    message: { ...parsed, leadId: resolved.leadId, clientId: resolved.clientId, tenantId },
  });

  if (result.reply && result.replySent && result.action !== "dnc" && parsed.from) {
    const subject = parsed.subject
      ? `Re: ${parsed.subject.replace(/^(Re:|Fwd:)\s*/i, "")}`
      : "Re: Your message";

    const sent = await sendGmailReply(tenantId, {
      from: parsed.from,
      subject,
      reply: result.reply,
      threadId: parsed.threadId,
    });

    if (sent) {
      await db.insert(schema.messages).values({
        id: randomUUID(),
        leadId: resolved.leadId,
        clientId: resolved.clientId,
        channel: "gmail",
        direction: "outbound",
        body: result.reply,
        gmailThreadId: sent.threadId,
      });
    }
  }

  return { processed: 1, duplicates: 0, skipped: 0 };
}