import { NextRequest, NextResponse } from "next/server";
import { db } from "@/backend/db";
import { getBooking, listMeetings } from "@/backend/calendar/service";
import { bookSlot, scheduleReminders } from "@/backend/calendar/booking";
import { BookingConflictError } from "@/backend/calendar/service";
import { requireAuth, requireRole } from "@/backend/auth/middleware";
import { and, eq } from "drizzle-orm";
import { schema } from "@/backend/db";
import { createNotificationForTenant, formatNotificationMessage } from "@/backend/services/notifications";
import { createMeeting as createCalendarEvent, updateBookingWithCalendarEvent } from "@/backend/services/calendar-composio";
import { composio2Service } from "@/backend/integrations/composio2";
import { createMeeting as createZoomMeeting, getConnection as getZoomConnection } from "@/backend/integrations/composio-zoom";
import { callWhatsAppApi } from "@/backend/messaging/whatsapp";
import { randomUUID } from "crypto";

// ── Meetings v1 API ──
// GET  /api/v1/meetings            → list tenant's meetings
// POST /api/v1/meetings            → create a booking (atomic)
// GET  /api/v1/meetings/available-slots?start=&end=&duration= → available slots

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));

  try {
    const rows = await listMeetings(db, auth.ctx.tenantId, {
      status: status ?? undefined,
      limit,
      offset,
    });
    return NextResponse.json({ meetings: rows });
  } catch (err) {
    console.error("[api/v1/meetings] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("member");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { leadId, startTime, durationMin, title, notes } = body as {
    leadId?: string;
    startTime?: string;
    durationMin?: number;
    title?: string;
    notes?: string;
  };

  if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }
  if (!startTime || isNaN(Date.parse(startTime))) {
    return NextResponse.json({ error: "valid startTime (ISO) required" }, { status: 400 });
  }

  const start = new Date(startTime);
  const duration = typeof durationMin === "number" && Number.isFinite(durationMin) ? Math.max(1, Math.floor(durationMin)) : 30;

  // Verify the lead belongs to this tenant before booking.
  const [clientLead] = await db
    .select({ id: schema.clientLeads.id })
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, auth.ctx.tenantId)))
    .limit(1);
  if (!clientLead) {
    return NextResponse.json({ error: "Lead not found for this tenant" }, { status: 404 });
  }

  try {
    const booking = await bookSlot(db, auth.ctx.tenantId, leadId, start, duration);
    try {
      await scheduleReminders(db, booking.id);
    } catch (reminderErr) {
      console.error("[api/v1/meetings] reminder scheduling failed", reminderErr);
    }

    // Create a host join link: Google Calendar (Meet) when connected, otherwise
    // Zoom when connected. If neither is connected, the booking simply has no
    // join URL and the confirmation omits it.
    let meetingUrl: string | null = null;
    let meetingProvider: "google_meet" | "zoom" | null = null;

    const [lead] = await db
      .select({ email: schema.leads.email, firstName: schema.leads.firstName, lastName: schema.leads.lastName })
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);

    const end = new Date(start.getTime() + duration * 60_000);
    const attendees = lead?.email ? [lead.email] : [];
    const leadName = [lead?.firstName, lead?.lastName].filter(Boolean).join(" ");

    const calendarState = await composio2Service.getCalendarConnectionState(auth.ctx.tenantId);
    if (calendarState.connected) {
      try {
        const calendarEvent = await createCalendarEvent(auth.ctx.tenantId, {
          title: title ?? `Meeting with ${leadName || "Prospect"}`,
          start,
          end,
          attendees,
          description: notes ?? undefined,
        });

        meetingUrl =
          calendarEvent.meetLink ??
          `https://calendar.google.com/calendar/event?eid=${calendarEvent.id}`;
        meetingProvider = "google_meet";
        await updateBookingWithCalendarEvent(auth.ctx.tenantId, booking.id, calendarEvent.id, calendarEvent.meetLink);
      } catch (calErr) {
        console.error("[api/v1/meetings] Google Calendar event creation failed (non-fatal)", calErr);
      }
    } else if (await getZoomConnection(auth.ctx.tenantId)) {
      try {
        const zoomMeeting = await createZoomMeeting(auth.ctx.tenantId, {
          topic: title ?? `Meeting with ${leadName || "Prospect"}`,
          startTime: start,
          durationMin: duration,
          attendees,
          agenda: notes ?? undefined,
        });
        meetingUrl = zoomMeeting.joinUrl;
        meetingProvider = "zoom";
      } catch (zoomErr) {
        console.error("[api/v1/meetings] Zoom meeting creation failed (non-fatal)", zoomErr);
      }
    }

    await db
      .update(schema.bookings)
      .set({ meetingUrl, meetingProvider })
      .where(and(eq(schema.bookings.id, booking.id), eq(schema.bookings.clientId, auth.ctx.tenantId)));

    const persistedBooking =
      (await getBooking(db, auth.ctx.tenantId, booking.id)) ?? { ...booking, meetingUrl, meetingProvider };

    await db
      .update(schema.clientLeads)
      .set({ status: "booked" })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, auth.ctx.tenantId)));

    try {
      const [waLead] = await db
        .select({ firstName: schema.leads.firstName, phoneE164: schema.leads.phoneE164 })
        .from(schema.leads)
        .where(eq(schema.leads.id, leadId))
        .limit(1);

      if (waLead?.phoneE164) {
        const waLeadName = waLead.firstName || "there";
        const dateStr = start.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "Asia/Kolkata",
        });
        const timeStr = start.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        });
        const meetingDetails = persistedBooking.meetingUrl
          ? `\nJoin: ${persistedBooking.meetingUrl}`
          : "";
        const params = [waLeadName, dateStr, timeStr, meetingDetails];

        const waId = await callWhatsAppApi(waLead.phoneE164, "meeting_link", params, auth.ctx.tenantId);
        if (waId) {
          await db.insert(schema.messages).values({
            id: randomUUID(),
            leadId,
            clientId: auth.ctx.tenantId,
            channel: "whatsapp",
            direction: "outbound",
            body: `Meeting booked for ${dateStr} at ${timeStr} IST${meetingDetails}`,
            waMessageId: waId,
            templateName: "meeting_link",
          });
        }
      }
    } catch (waErr) {
      console.error("[api/v1/meetings] WhatsApp confirmation failed (non-fatal)", waErr);
    }

    createNotificationForTenant(db, {
      tenantId: auth.ctx.tenantId,
      type: "meeting_booked",
      title: "Meeting Booked",
      message: formatNotificationMessage("meeting_booked", {
        meetingTime: start.toISOString(),
      }),
      leadId,
      meetingId: booking.id,
    }).catch(() => {});

    return NextResponse.json({ meeting: persistedBooking }, { status: 201 });
  } catch (err) {
    if (err instanceof BookingConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[api/v1/meetings] POST error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}