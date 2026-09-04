import { composio2Service } from "@/backend/integrations/composio2";
import { db, schema } from "@/backend/db";
import { and, eq } from "drizzle-orm";

const WHATSAPP_INTEGRATION = "whatsapp";

// Real Composio tool slugs for the WHATSAPP toolkit
// (https://docs.composio.dev/toolkits/whatsapp).
export const TOOL_SEND_MESSAGE = "WHATSAPP_SEND_MESSAGE";
export const TOOL_SEND_TEMPLATE = "WHATSAPP_SEND_TEMPLATE_MESSAGE";
export const TOOL_GET_PHONE_NUMBERS = "WHATSAPP_GET_PHONE_NUMBERS";

const DEFAULT_LANGUAGE_CODE = "en";

export async function getConnection(tenantId: string) {
  const [connection] = await db
    .select()
    .from(schema.oauthConnections)
    .where(
      and(
        eq(schema.oauthConnections.clientId, tenantId),
        eq(schema.oauthConnections.integration, WHATSAPP_INTEGRATION),
        eq(schema.oauthConnections.status, "active"),
      ),
    );
  if (connection?.composioConnectionId) {
    return connection;
  }
  const accountId = await composio2Service.resolveConnectedAccount(
    tenantId,
    WHATSAPP_INTEGRATION,
  );
  if (!accountId) return undefined;
  return {
    clientId: tenantId,
    integration: WHATSAPP_INTEGRATION,
    composioConnectionId: accountId,
    status: "active",
    accountEmail: null,
    lastSyncedAt: new Date(),
  } as typeof connection;
}

// Defensive response parsing.
// Tool responses are shaped { data, error, successful }, but `data` may be an
// OBJECT or a JSON STRING, and payloads may nest under `response_data`.

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

function extractItems(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  for (const key of ["items", "results", "messages"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null,
      );
    }
  }
  return [];
}

/**
 * Resolve the WhatsApp Business phone-number id for a connected account.
 * Prefers the WHATSAPP_PHONE_ID env var when set; otherwise queries the
 * connected account via the WHATSAPP_GET_PHONE_NUMBERS tool.
 */
export async function resolvePhoneNumberId(
  connectedAccountId: string,
): Promise<string | null> {
  const env = process.env.WHATSAPP_PHONE_ID;
  if (env) return env;

  try {
    const client = composio2Service.getClient();
    const result = await client.tools.execute(TOOL_GET_PHONE_NUMBERS, {
      connectedAccountId,
      arguments: {},
      dangerouslySkipVersionCheck: true,
    });
    if (!result.successful) return null;

    const data = unwrapResponse(result.data);
    const items = extractItems(data);
    const first = items[0];
    if (!first) return null;

    const id =
      typeof first["id"] === "string"
        ? first["id"]
        : typeof first["phoneNumberId"] === "string"
          ? first["phoneNumberId"]
          : null;
    return id;
  } catch {
    return null;
  }
}

/**
 * Send a plain WhatsApp text message to a phone E.164 via the tenant's
 * connected account. Returns the provider message id, or null on failure.
 */
export async function sendText(
  tenantId: string,
  to: string,
  body: string,
): Promise<string | null> {
  const connection = await getConnection(tenantId);
  const connectedAccountId = connection?.composioConnectionId ?? null;
  if (!connectedAccountId) {
    return null;
  }

  const phoneNumberId = await resolvePhoneNumberId(connectedAccountId);
  if (!phoneNumberId) {
    return null;
  }

  try {
    const client = composio2Service.getClient();
    const result = await client.tools.execute(TOOL_SEND_MESSAGE, {
      connectedAccountId,
      arguments: {
        phone_number_id: phoneNumberId,
        to,
        body,
      },
      dangerouslySkipVersionCheck: true,
    });
    if (!result.successful) {
      return null;
    }
    const data = unwrapResponse(result.data);
    return typeof data["messageId"] === "string" ? data["messageId"] : null;
  } catch {
    return null;
  }
}

/**
 * Send a templated WhatsApp message (approved template) via the tenant's
 * connected account. Returns the provider message id, or null on failure.
 */
export async function sendTemplate(
  tenantId: string,
  to: string,
  templateName: string,
  params: string[] = [],
  languageCode: string = DEFAULT_LANGUAGE_CODE,
): Promise<string | null> {
  const connection = await getConnection(tenantId);
  const connectedAccountId = connection?.composioConnectionId ?? null;
  if (!connectedAccountId) {
    return null;
  }

  const phoneNumberId = await resolvePhoneNumberId(connectedAccountId);
  if (!phoneNumberId) {
    return null;
  }

  try {
    const client = composio2Service.getClient();
    const result = await client.tools.execute(TOOL_SEND_TEMPLATE, {
      connectedAccountId,
      arguments: {
        phone_number_id: phoneNumberId,
        to,
        template_name: templateName,
        language_code: languageCode,
        components: params.map((p) => ({ type: "body", parameters: [{ type: "text", text: p }] })),
      },
      dangerouslySkipVersionCheck: true,
    });
    if (!result.successful) {
      return null;
    }
    const data = unwrapResponse(result.data);
    return typeof data["messageId"] === "string" ? data["messageId"] : null;
  } catch {
    return null;
  }
}
