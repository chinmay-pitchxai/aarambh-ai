import { composioService } from "@/backend/integrations/composio";
import { db, schema } from "@/backend/db";
import { and, eq } from "drizzle-orm";

const GOOGLE_CALENDAR_INTEGRATION = "google_calendar";

// Real Composio tool slugs for the GOOGLECALENDAR toolkit
// (https://docs.composio.dev/toolkits/googlecalendar).
export const TOOL_CREATE_EVENT = "GOOGLECALENDAR_CREATE_EVENT";
export const TOOL_EVENTS_LIST = "GOOGLECALENDAR_EVENTS_LIST";
export const TOOL_DELETE_EVENT = "GOOGLECALENDAR_DELETE_EVENT";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_CALENDAR_ID = "primary";
const WORK_START_HOUR_IST = 9;
const WORK_END_HOUR_IST = 18;
// IST has no DST: fixed +05:30 offset, so wall-clock conversions are exact.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  attendees: string[];
  description?: string;
  htmlLink?: string;
  meetLink?: string;
  status: string;
}

export interface CreateEventInput {
  title: string;
  start: Date;
  end: Date;
  attendees?: string[];
  description?: string;
  timezone?: string;
  location?: string;
}

async function getConnectedAccountId(tenantId: string): Promise<string | null> {
  const [connection] = await db
    .select()
    .from(schema.oauthConnections)
    .where(
      and(
        eq(schema.oauthConnections.clientId, tenantId),
        eq(schema.oauthConnections.integration, GOOGLE_CALENDAR_INTEGRATION),
        eq(schema.oauthConnections.status, "active"),
      )
    );

  return connection?.composioConnectionId ?? null;
}

// ── Defensive response parsing ──────────────────────────────────────────────
// Tool responses are shaped { data, error, successful }, but `data` may be an
// OBJECT or a JSON STRING, and create/list payloads may nest under
// `response_data`. Every accessor below tolerates all of those forms.

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

/** Merge a nested `response_data` object (or JSON string) into the top level. */
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
  for (const key of ["items", "events", "results"]) {
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

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function mapGoogleEvent(
  item: Record<string, unknown>,
  fallback?: { start?: Date; end?: Date; title?: string }
): CalendarEvent | null {
  const startRaw = asRecord(item["start"]);
  const endRaw = asRecord(item["end"]);
  const start =
    toDate(startRaw?.["dateTime"]) ??
    toDate(item["start"]) ??
    fallback?.start ??
    null;
  const end =
    toDate(endRaw?.["dateTime"]) ??
    toDate(item["end"]) ??
    fallback?.end ??
    null;
  if (!start || !end) return null;

  const attendeesRaw = item["attendees"];
  const attendees = Array.isArray(attendeesRaw)
    ? attendeesRaw
        .map((entry) =>
          typeof entry === "string" ? entry : asRecord(entry)?.["email"]
        )
        .filter((email): email is string => typeof email === "string" && email.length > 0)
    : [];

  const htmlLink =
    typeof item["htmlLink"] === "string"
      ? item["htmlLink"]
      : typeof item["html_link"] === "string"
        ? item["html_link"]
        : undefined;

  const meetLink =
    typeof item["hangoutLink"] === "string"
      ? item["hangoutLink"]
      : typeof item["conferenceData"] === "object" && item["conferenceData"] !== null
        ? typeof (item["conferenceData"] as Record<string, unknown>)["entryPoints"] === "string"
          ? (item["conferenceData"] as Record<string, unknown>)["entryPoints"] as string
          : undefined
        : undefined;

  return {
    id: typeof item["id"] === "string" ? item["id"] : "",
    title:
      typeof item["summary"] === "string"
        ? item["summary"]
        : typeof item["title"] === "string"
          ? item["title"]
          : (fallback?.title ?? "Untitled"),
    start,
    end,
    attendees,
    description: typeof item["description"] === "string" ? item["description"] : undefined,
    htmlLink,
    meetLink,
    status: typeof item["status"] === "string" ? item["status"] : "confirmed",
  };
}

/**
 * Format a Date as a naive local ISO string (`YYYY-MM-DDTHH:mm:ss`, no
 * timezone suffix) in the given IANA timezone — the shape
 * GOOGLECALENDAR_CREATE_EVENT expects for `start_datetime` alongside the
 * separate `timezone` param.
 */
export function toNaiveLocalISO(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

async function executeCalendarTool(
  tenantId: string,
  toolSlug: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const connectedAccountId = await getConnectedAccountId(tenantId);
  if (!connectedAccountId) {
    throw new Error(
      "Google Calendar is not connected for this workspace. Connect it from the Connections page, then retry."
    );
  }

  const client = composioService.getClient();
  let result;
  try {
    result = await client.tools.execute(toolSlug, {
      connectedAccountId,
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });
  } catch (err) {
    throw new Error(
      `Google Calendar tool ${toolSlug} failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!result.successful) {
    throw new Error(result.error || `Google Calendar tool ${toolSlug} failed`);
  }

  return unwrapResponse(result.data);
}

export async function getUpcomingMeetings(
  tenantId: string,
  maxResults = 50
): Promise<CalendarEvent[]> {
  const now = new Date();
  const data = await executeCalendarTool(tenantId, TOOL_EVENTS_LIST, {
    calendarId: DEFAULT_CALENDAR_ID,
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults,
  });

  return extractItems(data)
    .map((item) => mapGoogleEvent(item))
    .filter((event): event is CalendarEvent => event !== null);
}

/** IST calendar-day parts for a given instant. */
function istDayParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

export async function getAvailableSlots(
  tenantId: string,
  date: Date,
  duration = 30
): Promise<Array<{ start: Date; end: Date }>> {
  const { year, month, day } = istDayParts(date);

  // Weekends skipped: no bookable slots on Saturday/Sunday (IST).
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return [];

  const dayStartUtc = new Date(Date.UTC(year, month, day, WORK_START_HOUR_IST, 0, 0) - IST_OFFSET_MS);
  const dayEndUtc = new Date(Date.UTC(year, month, day, WORK_END_HOUR_IST, 0, 0) - IST_OFFSET_MS);

  const data = await executeCalendarTool(tenantId, TOOL_EVENTS_LIST, {
    calendarId: DEFAULT_CALENDAR_ID,
    timeMin: dayStartUtc.toISOString(),
    timeMax: dayEndUtc.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  });

  const busy: Array<{ start: Date; end: Date }> = [];
  for (const item of extractItems(data)) {
    const startRaw = asRecord(item["start"]);
    const endRaw = asRecord(item["end"]);
    const start = toDate(startRaw?.["dateTime"]) ?? toDate(item["start"]);
    const end = toDate(endRaw?.["dateTime"]) ?? toDate(item["end"]);
    if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      busy.push({ start, end });
    } else if (
      typeof startRaw?.["date"] === "string" ||
      typeof endRaw?.["date"] === "string"
    ) {
      // All-day event: treat the whole working day as busy.
      busy.push({ start: dayStartUtc, end: dayEndUtc });
    }
  }

  const slots: Array<{ start: Date; end: Date }> = [];
  const slotMs = Math.max(1, Math.floor(duration)) * 60 * 1000;
  const stepMs = 30 * 60 * 1000;

  for (let t = dayStartUtc.getTime(); t + slotMs <= dayEndUtc.getTime(); t += stepMs) {
    const slotStart = new Date(t);
    const slotEnd = new Date(t + slotMs);
    const overlaps = busy.some((span) => slotStart < span.end && slotEnd > span.start);
    if (!overlaps) {
      slots.push({ start: slotStart, end: slotEnd });
    }
  }

  return slots;
}

export async function createMeeting(
  tenantId: string,
  input: CreateEventInput
): Promise<CalendarEvent> {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const diffMs = input.end.getTime() - input.start.getTime();
  if (!Number.isFinite(diffMs) || diffMs <= 0) {
    throw new Error("Invalid event window: end must be after start.");
  }

  const totalMinutes = Math.max(1, Math.round(diffMs / 60_000));
  const eventDurationHour = Math.floor(totalMinutes / 60);
  const eventDurationMinutes = totalMinutes % 60;

  const args: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? "",
    start_datetime: toNaiveLocalISO(input.start, timezone),
    timezone,
    calendar_id: DEFAULT_CALENDAR_ID,
    attendees: input.attendees ?? [],
    create_meeting_room: true,
    send_updates: "all",
  };
  if (eventDurationHour > 0) args["event_duration_hour"] = eventDurationHour;
  if (eventDurationMinutes > 0) args["event_duration_minutes"] = eventDurationMinutes;
  if (input.location) args["location"] = input.location;

  const data = await executeCalendarTool(tenantId, TOOL_CREATE_EVENT, args);

  const mapped = mapGoogleEvent(data, {
    start: input.start,
    end: input.end,
    title: input.title,
  }) ?? {
    id: "",
    title: input.title,
    start: input.start,
    end: input.end,
    attendees: [] as string[],
    description: undefined as string | undefined,
    htmlLink: undefined as string | undefined,
    meetLink: undefined as string | undefined,
    status: "confirmed",
  };

  // The create-event response rarely echoes attendees/description back.
  return {
    ...mapped,
    attendees:
      mapped.attendees.length > 0 ? mapped.attendees : (input.attendees ?? []),
    description: mapped.description ?? input.description,
    meetLink: mapped.meetLink,
  };
}

export async function cancelMeeting(
  tenantId: string,
  eventId: string
): Promise<{ success: boolean }> {
  if (!eventId) {
    throw new Error("eventId is required to cancel a meeting.");
  }
  await executeCalendarTool(tenantId, TOOL_DELETE_EVENT, {
    event_id: eventId,
    calendar_id: DEFAULT_CALENDAR_ID,
  });
  return { success: true };
}

export async function updateBookingWithCalendarEvent(
  tenantId: string,
  bookingId: string,
  eventId: string,
  meetLink?: string,
): Promise<void> {
  const url = meetLink || `https://calendar.google.com/calendar/event?eid=${eventId}`;
  await db
    .update(schema.bookings)
    .set({ meetingUrl: url })
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.clientId, tenantId)));
}
