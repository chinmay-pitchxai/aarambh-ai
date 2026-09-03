import { NextRequest, NextResponse } from "next/server";
import { db } from "@/backend/db";
import { listMeetings } from "@/backend/calendar/service";
import { bookSlot, scheduleReminders } from "@/backend/calendar/booking";
import { BookingConflictError } from "@/backend/calendar/service";
import { requireAuth, requireRole } from "@/backend/auth/middleware";
import { and, eq } from "drizzle-orm";
import { schema } from "@/backend/db";
import { createNotificationForTenant, formatNotificationMessage } from "@/backend/services/notifications";

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

  const { leadId, startTime, durationMin, title, notes, meetingUrl } = body as {
    leadId?: string;
    startTime?: string;
    durationMin?: number;
    title?: string;
    notes?: string;
    meetingUrl?: string;
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

    await db
      .update(schema.clientLeads)
      .set({ status: "booked" })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, auth.ctx.tenantId)));

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

    return NextResponse.json({ meeting: booking }, { status: 201 });
  } catch (err) {
    if (err instanceof BookingConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[api/v1/meetings] POST error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}