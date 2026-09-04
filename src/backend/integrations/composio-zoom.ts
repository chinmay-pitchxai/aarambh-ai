import { composio2Service } from "@/backend/integrations/composio2";
import { db, schema } from "@/backend/db";
import { and, eq } from "drizzle-orm";

const ZOOM_INTEGRATION = "zoom";

// Real Composio tool slugs for the ZOOM toolkit
// (https://docs.composio.dev/toolkits/zoom).
export const TOOL_CREATE_MEETING = "ZOOM_CREATE_A_MEETING";
export const TOOL_DELETE_MEETING = "ZOOM_DELETE_A_MEETING";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_DURATION_MIN = 30;

export interface ZoomMeeting {
  id: string;
  joinUrl: string;
  startUrl?: string;
  topic: string;
  startTime?: string;
  durationMin?: number;
}

export interface CreateZoomMeetingInput {
  topic: string;
  startTime: Date;
  durationMin?: number;
  attendees?: string[];
  agenda?: string;
  timezone?: string;
}

export async function getConnection(tenantId: string) {
  const [connection] = await db
    .select()
    .from(schema.oauthConnections)
    .where(
      and(
        eq(schema.oauthConnections.clientId, tenantId),
        eq(schema.oauthConnections.integration, ZOOM_INTEGRATION),
        eq(schema.oauthConnections.status, "active"),
      ),
    );
  if (connection?.composioConnectionId) {
    return connection;
  }
  const accountId = await composio2Service.resolveConnectedAccount(
    tenantId,
    ZOOM_INTEGRATION,
  );
  if (!accountId) return null;
  return {
    clientId: tenantId,
    integration: ZOOM_INTEGRATION,
    composioConnectionId: accountId,
    status: "active",
    accountEmail: null,
    lastSyncedAt: new Date(),
  } as typeof connection;
}

// ── Defensive response parsing ──────────────────────────────────────────────
// Mirrors calendar-composio: `data` may be an OBJECT or a JSON STRING, and the
// payload may nest under `response_data`.

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

function pickString(payload: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

async function executeZoomTool(
  tenantId: string,
  toolSlug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const connection = await getConnection(tenantId);
  const connectedAccountId = connection?.composioConnectionId ?? null;
  if (!connectedAccountId) {
    throw new Error(
      "Zoom is not connected for this workspace. Connect it from the Connections page, then retry.",
    );
  }

  const client = composio2Service.getClient();
  let result;
  try {
    result = await client.tools.execute(toolSlug, {
      connectedAccountId,
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });
  } catch (err) {
    throw new Error(
      `Zoom tool ${toolSlug} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!result.successful) {
    throw new Error(result.error || `Zoom tool ${toolSlug} failed`);
  }

  return unwrapResponse(result.data);
}

export async function createMeeting(
  tenantId: string,
  input: CreateZoomMeetingInput,
): Promise<ZoomMeeting> {
  const durationMin = Math.max(1, Math.floor(input.durationMin ?? DEFAULT_DURATION_MIN));

  const args: Record<string, unknown> = {
    topic: input.topic,
    type: 2,
    start_time: input.startTime.toISOString(),
    duration: durationMin,
    timezone: input.timezone ?? DEFAULT_TIMEZONE,
  };
  if (input.agenda) args["agenda"] = input.agenda;
  const attendees = (input.attendees ?? []).filter(
    (email): email is string => typeof email === "string" && email.length > 0,
  );
  if (attendees.length > 0) {
    args["settings__meeting__invitees"] = attendees.map((email) => ({ email }));
  }

  const data = await executeZoomTool(tenantId, TOOL_CREATE_MEETING, args);

  const joinUrl = pickString(data, "join_url", "joinUrl");
  if (!joinUrl) {
    throw new Error(
      `Zoom tool ${TOOL_CREATE_MEETING} succeeded but returned no join_url. ` +
        `Check the ${TOOL_CREATE_MEETING} response shape and fix the slug/parser if it changed.`,
    );
  }

  const id =
    typeof data["id"] === "string"
      ? data["id"]
      : typeof data["id"] === "number"
        ? String(data["id"])
        : "";

  return {
    id,
    joinUrl,
    startUrl: pickString(data, "start_url", "startUrl"),
    topic: pickString(data, "topic") ?? input.topic,
    startTime: pickString(data, "start_time", "startTime"),
    durationMin: typeof data["duration"] === "number" ? data["duration"] : durationMin,
  };
}

export async function createMeetingLink(
  tenantId: string,
  input: CreateZoomMeetingInput,
): Promise<string> {
  const meeting = await createMeeting(tenantId, input);
  return meeting.joinUrl;
}

export async function deleteMeeting(
  tenantId: string,
  meetingId: string,
): Promise<{ success: boolean }> {
  if (!meetingId) {
    throw new Error("meetingId is required to delete a Zoom meeting.");
  }
  await executeZoomTool(tenantId, TOOL_DELETE_MEETING, { meeting_id: meetingId });
  return { success: true };
}
