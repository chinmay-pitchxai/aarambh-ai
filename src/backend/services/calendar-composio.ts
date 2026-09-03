import { composioService } from "@/backend/integrations/composio";
import { db, schema } from "@/backend/db";
import { and, eq, gte, asc } from "drizzle-orm";

const GOOGLE_CALENDAR_INTEGRATION = "google_calendar";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  attendees: string[];
  description?: string;
  htmlLink?: string;
  status: string;
}

export interface CreateEventInput {
  title: string;
  start: Date;
  end: Date;
  attendees?: string[];
  description?: string;
  timezone?: string;
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

async function executeCalendarTool(
  tenantId: string,
  toolSlug: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const connectedAccountId = await getConnectedAccountId(tenantId);
  if (!connectedAccountId) {
    throw new Error("Google Calendar not connected. Please connect it from the Connections page.");
  }

  const client = composioService.getClient();
  const result = await client.tools.execute(toolSlug, {
    connectedAccountId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });

  if (!result.successful) {
    throw new Error(result.error || `Failed to execute ${toolSlug}`);
  }

  return result.data;
}

export async function getUpcomingMeetings(tenantId: string): Promise<CalendarEvent[]> {
  const data = await executeCalendarTool(tenantId, "GOOGLECALENDAR_GET_CALENDAR_EVENTS_IN_RANGE", {
    start_time: new Date().toISOString(),
    end_time: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const items = (data.items ?? []) as Array<Record<string, unknown>>;
  return items.map((item) => ({
    id: (item.id as string) ?? "",
    title: (item.summary as string) ?? "Untitled",
    start: new Date((item.start as Record<string, string>)?.dateTime ?? (item.start as Record<string, string>)?.date ?? ""),
    end: new Date((item.end as Record<string, string>)?.dateTime ?? (item.end as Record<string, string>)?.date ?? ""),
    attendees: ((item.attendees as Array<Record<string, string>>) ?? []).map((a) => a.email ?? "").filter(Boolean),
    description: (item.description as string) ?? undefined,
    htmlLink: (item.htmlLink as string) ?? undefined,
    status: (item.status as string) ?? "confirmed",
  }));
}

export async function getAvailableSlots(
  tenantId: string,
  date: Date,
  duration: number = 30,
): Promise<Array<{ start: Date; end: Date }>> {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0, 0, 0);
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 18, 0, 0, 0);

  const busyData = await executeCalendarTool(tenantId, "GOOGLECALENDAR_GET_CALENDAR_EVENTS_IN_RANGE", {
    start_time: dayStart.toISOString(),
    end_time: dayEnd.toISOString(),
  });

  const busyItems = (busyData.items ?? []) as Array<Record<string, unknown>>;
  const busySlots: Array<{ start: Date; end: Date }> = busyItems.map((item) => ({
    start: new Date((item.start as Record<string, string>)?.dateTime ?? ""),
    end: new Date((item.end as Record<string, string>)?.dateTime ?? ""),
  }));

  const slots: Array<{ start: Date; end: Date }> = [];
  const slotDurationMs = duration * 60 * 1000;

  for (let minutes = 9 * 60; minutes + duration <= 18 * 60; minutes += 30) {
    const slotStart = new Date(dayStart);
    slotStart.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + slotDurationMs);

    const isBusy = busySlots.some((busy) => slotStart < busy.end && slotEnd > busy.start);
    if (!isBusy) {
      slots.push({ start: slotStart, end: slotEnd });
    }
  }

  return slots;
}

export async function createMeeting(
  tenantId: string,
  input: CreateEventInput,
): Promise<CalendarEvent> {
  const data = await executeCalendarTool(tenantId, "GOOGLECALENDAR_CREATE_CALENDAR_EVENT", {
    summary: input.title,
    description: input.description ?? "",
    start_time: input.start.toISOString(),
    end_time: input.end.toISOString(),
    attendees: (input.attendees ?? []).map((email) => ({ email })),
    timezone: input.timezone ?? "Asia/Kolkata",
  });

  return {
    id: (data.id as string) ?? "",
    title: (data.summary as string) ?? input.title,
    start: new Date((data.start as Record<string, string>)?.dateTime ?? input.start.toISOString()),
    end: new Date((data.end as Record<string, string>)?.dateTime ?? input.end.toISOString()),
    attendees: (input.attendees ?? []),
    description: input.description,
    htmlLink: (data.htmlLink as string) ?? undefined,
    status: (data.status as string) ?? "confirmed",
  };
}

export async function cancelMeeting(
  tenantId: string,
  eventId: string,
): Promise<{ success: boolean }> {
  await executeCalendarTool(tenantId, "GOOGLECALENDAR_DELETE_CALENDAR_EVENT", {
    event_id: eventId,
  });
  return { success: true };
}

export async function updateBookingWithCalendarEvent(
  tenantId: string,
  bookingId: string,
  eventId: string,
): Promise<void> {
  await db
    .update(schema.bookings)
    .set({ meetingUrl: `https://calendar.google.com/calendar/event?eid=${eventId}` })
    .where(
      and(
        eq(schema.bookings.id, bookingId),
        eq(schema.bookings.clientId, tenantId),
      )
    );
}
