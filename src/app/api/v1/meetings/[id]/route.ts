import { NextRequest, NextResponse } from "next/server";
import { db } from "@/backend/db";
import {
  BookingConflictError,
  BookingNotFoundError,
  BookingNotAllowedError,
  cancelMeeting,
  confirmMeeting,
  getBooking,
  rescheduleMeeting,
} from "@/backend/calendar/service";
import { scheduleReminders } from "@/backend/calendar/booking";
import { requireAuth, requireRole } from "@/backend/auth/middleware";
import { and, eq } from "drizzle-orm";
import { schema } from "@/backend/db";

// ── Meetings v1 API (single resource) ──
// GET   /api/v1/meetings/[id] → get one meeting
// PATCH /api/v1/meetings/[id] → update (confirm / cancel / reschedule)

const VALID_STATUSES = ["confirmed", "cancelled"] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const booking = await getBooking(db, auth.ctx.tenantId, id);
    if (!booking) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

    const [lead] = await db
      .select({
        firstName: schema.leads.firstName,
        lastName: schema.leads.lastName,
        email: schema.leads.email,
        phone: schema.leads.phoneE164,
        company: schema.leads.company,
      })
      .from(schema.leads)
      .where(eq(schema.leads.id, booking.leadId))
      .limit(1);

    return NextResponse.json({ meeting: { ...booking, lead: lead ?? null } });
  } catch (err) {
    console.error("[api/v1/meetings/[id]] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole("member");
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { status, startTime, durationMin } = body as {
    status?: string;
    startTime?: string;
    durationMin?: number;
  };

  try {
    // Reschedule: update time/duration with atomic overlap check.
    if (startTime || typeof durationMin === "number") {
      if (!startTime || isNaN(Date.parse(startTime))) {
        return NextResponse.json({ error: "valid startTime (ISO) required to reschedule" }, { status: 400 });
      }
      const newStart = new Date(startTime);
      const duration = typeof durationMin === "number" && Number.isFinite(durationMin) ? Math.max(1, Math.floor(durationMin)) : 30;

      const updated = await rescheduleMeeting(db, auth.ctx.tenantId, id, newStart, duration);
      try {
        await scheduleReminders(db, id);
      } catch (reminderErr) {
        console.error("[api/v1/meetings/[id]] reminder rescheduling failed", reminderErr);
      }
      return NextResponse.json({ meeting: updated });
    }

    if (!status || !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(", ")} (or provide startTime to reschedule)` },
        { status: 400 },
      );
    }

    const meeting =
      status === "cancelled"
        ? await cancelMeeting(db, auth.ctx.tenantId, id)
        : await confirmMeeting(db, auth.ctx.tenantId, id);

    return NextResponse.json({ meeting });
  } catch (err) {
    if (err instanceof BookingNotFoundError) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }
    if (err instanceof BookingConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof BookingNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[api/v1/meetings/[id]] PATCH error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}