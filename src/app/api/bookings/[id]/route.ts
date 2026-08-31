import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { eq } from "drizzle-orm";

const VALID_STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "no_show"] as const;

type BookingStatus = (typeof VALID_STATUSES)[number];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || typeof id !== "string" || id.trim().length === 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const [booking] = await db
      .select({
        id: schema.bookings.id,
        leadId: schema.bookings.leadId,
        clientId: schema.bookings.clientId,
        callId: schema.bookings.callId,
        status: schema.bookings.status,
        scheduledAt: schema.bookings.scheduledAt,
        durationMin: schema.bookings.durationMin,
        meetingUrl: schema.bookings.meetingUrl,
        notes: schema.bookings.notes,
        createdAt: schema.bookings.createdAt,
        firstName: schema.leads.firstName,
        lastName: schema.leads.lastName,
        email: schema.leads.email,
        phone: schema.leads.phoneE164,
        company: schema.leads.company,
      })
      .from(schema.bookings)
      .innerJoin(schema.leads, eq(schema.bookings.leadId, schema.leads.id))
      .where(eq(schema.bookings.id, id))
      .limit(1);

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    let calls: unknown[] = [];
    if (booking.callId) {
      calls = await db
        .select()
        .from(schema.calls)
        .where(eq(schema.calls.id, booking.callId));
    } else {
      calls = await db
        .select()
        .from(schema.calls)
        .where(eq(schema.calls.leadId, booking.leadId))
        .limit(5);
    }

    return NextResponse.json({ booking, calls });
  } catch (err) {
    console.error("[api/bookings/[id]] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { status } = body as { status?: string };

  if (!status || !VALID_STATUSES.includes(status as BookingStatus)) {
    return NextResponse.json(
      { error: `status required and must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const [existing] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    await db
      .update(schema.bookings)
      .set({ status: status as BookingStatus })
      .where(eq(schema.bookings.id, id));

    const [updated] = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, id))
      .limit(1);

    return NextResponse.json({ booking: updated });
  } catch (err) {
    console.error("[api/bookings/[id]] PATCH error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
