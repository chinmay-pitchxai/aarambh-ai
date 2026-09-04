import { composio2Service } from "@/backend/integrations/composio2";
import { db, schema } from "@/backend/db";
import { and, eq } from "drizzle-orm";

const GMAIL_INTEGRATION = "gmail";

// Real Composio tool slugs for the GMAIL toolkit
// (https://docs.composio.dev/toolkits/gmail).
export const TOOL_SEND_EMAIL = "GMAIL_SEND_EMAIL";
export const TOOL_REPLY_TO_THREAD = "GMAIL_REPLY_TO_THREAD";
export const TOOL_LIST_THREADS = "GMAIL_LIST_THREADS";
export const TOOL_FETCH_THREAD = "GMAIL_FETCH_MESSAGE_BY_THREAD_ID";

export interface GmailSendInput {
  to: string;
  subject: string;
  body: string;
  /** When set, the send becomes an in-thread reply. */
  inReplyToThreadId?: string;
}

export interface GmailSendResult {
  id: string;
  threadId: string;
}

export interface GmailThread {
  id: string;
  snippet?: string;
  historyId?: string;
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  internalDate?: string;
}

interface GmailAction {
  slug: string;
  arguments: Record<string, unknown>;
}

/**
 * Looks up the active Composio connected-account id for the tenant's Gmail
 * oauthConnections row, or null when Gmail is not connected.
 */
export async function getConnection(tenantId: string): Promise<string | null> {
  const [connection] = await db
    .select()
    .from(schema.oauthConnections)
    .where(
      and(
        eq(schema.oauthConnections.clientId, tenantId),
        eq(schema.oauthConnections.integration, GMAIL_INTEGRATION),
        eq(schema.oauthConnections.status, "active"),
      )
    );

  if (connection?.composioConnectionId) {
    return connection.composioConnectionId;
  }

  return composio2Service.resolveConnectedAccount(tenantId, GMAIL_INTEGRATION);
}

/**
 * Executes a Gmail tool through the tenant's connected account, mirroring the
 * exact SDK invocation used by the calendar integration
 * (`composioService.getClient().tools.execute` with a connectedAccountId).
 */
export async function runGmailConnectedAccount(
  tenantId: string,
  action: GmailAction
): Promise<Record<string, unknown>> {
  const connectedAccountId = await getConnection(tenantId);
  if (!connectedAccountId) {
    throw new Error(
      "Gmail is not connected for this workspace. Connect it from the Connections page, then retry."
    );
  }

  const client = composio2Service.getClient();
  let result;
  try {
    result = await client.tools.execute(action.slug, {
      connectedAccountId,
      arguments: action.arguments,
      dangerouslySkipVersionCheck: true,
    });
  } catch (err) {
    throw new Error(
      `Gmail tool ${action.slug} failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!result.successful) {
    throw new Error(result.error || `Gmail tool ${action.slug} failed`);
  }

  return unwrapResponse(result.data);
}

// ── Defensive response parsing ────────────────────────────────────────────────
// Tool responses are shaped { data, error, successful }, but `data` may be an
// OBJECT or a JSON STRING, and nested payloads may sit under `response_data`. The
// accessors below tolerate all of those forms (same conventions as calendar).

function parseToolData(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return {};
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return { items: parsed };
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      return {};
    } catch {
      return {};
    }
  }
  if (Array.isArray(data)) return { items: data };
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return {};
}

function unwrapResponse(data: unknown): Record<string, unknown> {
  const obj = parseToolData(data);
  const nested = obj["response_data"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...obj, ...(nested as Record<string, unknown>) };
  }
  if (typeof nested === "string") {
    return { ...obj, ...parseToolData(nested) };
  }
  return obj;
}

function extractItems(
  payload: Record<string, unknown>,
  keys: string[]
): Array<Record<string, unknown>> {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null
      );
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (!Array.isArray(headers)) return undefined;
  for (const h of headers) {
    const header = asRecord(h);
    const key = header?.["name"];
    if (typeof key === "string" && key.toLowerCase() === name.toLowerCase()) {
      const value = header?.["value"];
      if (typeof value === "string") return value;
    }
  }
  return undefined;
}

// Decodes the first text/plain part of a base64url-encoded Gmail payload.
function decodeBody(payload: unknown): string {
  const payloadRec = asRecord(payload);
  if (!payloadRec) return "";

  const parts = payloadRec["parts"];
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const p = asRecord(part);
      const mimeType = typeof p?.["mimeType"] === "string" ? p["mimeType"] : "";
      if (mimeType.startsWith("text/")) {
        const bodyData = asRecord(p?.["body"])?.["data"];
        if (typeof bodyData === "string" && bodyData.length > 0) {
          const base64 = bodyData.replace(/-/g, "+").replace(/_/g, "/");
          try {
            const decoded = Buffer.from(base64, "base64").toString("utf8");
            if (decoded.trim().length > 0) return decoded;
          } catch {
            // fall through
          }
        }
      }
    }
  }

  const bodyData = payloadRec["body"];
  if (typeof bodyData === "string") return bodyData;
  const nested = asRecord(bodyData)?.["data"];
  if (typeof nested === "string" && nested.length > 0 && !nested.includes("\uFFFD")) {
    try {
      return Buffer.from(nested.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return "";
}

function mapThread(item: Record<string, unknown>): GmailThread {
  const id =
    typeof item["id"] === "string"
      ? item["id"]
      : typeof item["threadId"] === "string"
        ? item["threadId"]
        : "";
  const snippet = typeof item["snippet"] === "string" ? item["snippet"] : undefined;
  const historyId =
    typeof item["historyId"] === "string"
      ? item["historyId"]
      : typeof item["history_id"] === "string"
        ? item["history_id"]
        : undefined;
  return { id, snippet, historyId };
}

function mapMessage(item: Record<string, unknown>): GmailMessage {
  const headers = item["payload"] && asRecord(item["payload"])?.["headers"];
  const subject = headerValue(headers, "Subject");
  const from = headerValue(headers, "From");
  const to = headerValue(headers, "To");
  const body = decodeBody(item["payload"]);

  return {
    id: typeof item["id"] === "string" ? item["id"] : "",
    threadId:
      typeof item["threadId"] === "string"
        ? item["threadId"]
        : typeof item["thread_id"] === "string"
          ? item["thread_id"]
          : undefined,
    snippet: typeof item["snippet"] === "string" ? item["snippet"] : undefined,
    from,
    to,
    subject,
    body:
      body.length > 0
        ? body
        : typeof item["snippet"] === "string"
          ? item["snippet"]
          : undefined,
    internalDate:
      typeof item["internalDate"] === "string"
        ? item["internalDate"]
        : typeof item["internal_date"] === "string"
          ? item["internal_date"]
          : undefined,
  };
}

function extractSendResult(data: Record<string, unknown>): GmailSendResult | null {
  const id =
    typeof data["id"] === "string"
      ? data["id"]
      : typeof data["messageId"] === "string"
        ? data["messageId"]
        : null;
  const threadId =
    typeof data["threadId"] === "string"
      ? data["threadId"]
      : typeof data["thread_id"] === "string"
        ? data["thread_id"]
        : id;
  if (!id) return null;
  return { id, threadId: threadId ?? id };
}

export async function sendEmail(
  tenantId: string,
  input: GmailSendInput
): Promise<GmailSendResult | null> {
  let data: Record<string, unknown>;
  if (input.inReplyToThreadId) {
    data = await runGmailConnectedAccount(tenantId, {
      slug: TOOL_REPLY_TO_THREAD,
      arguments: {
        thread_id: input.inReplyToThreadId,
        recipient_email: input.to,
        message_body: input.body,
        is_html: false,
      },
    });
  } else {
    data = await runGmailConnectedAccount(tenantId, {
      slug: TOOL_SEND_EMAIL,
      arguments: {
        recipient_email: input.to,
        subject: input.subject,
        body: input.body,
        is_html: false,
      },
    });
  }

  const result = extractSendResult(data);
  if (!result) return null;
  return {
    id: result.id,
    threadId: result.threadId ?? input.inReplyToThreadId ?? result.id,
  };
}

export async function listThreads(
  tenantId: string,
  query = "",
  maxResults = 20
): Promise<GmailThread[]> {
  const data = await runGmailConnectedAccount(tenantId, {
    slug: TOOL_LIST_THREADS,
    arguments: { query, max_results: maxResults, verbose: false },
  });

  return extractItems(data, ["items", "threads", "results", "data"])
    .map(mapThread)
    .filter((thread) => thread.id.length > 0);
}

export async function getThreadMessages(
  tenantId: string,
  threadId: string
): Promise<GmailMessage[]> {
  const data = await runGmailConnectedAccount(tenantId, {
    slug: TOOL_FETCH_THREAD,
    arguments: { thread_id: threadId },
  });

  return extractItems(data, ["items", "messages", "results", "data"])
    .map(mapMessage)
    .filter((message) => message.id.length > 0);
}