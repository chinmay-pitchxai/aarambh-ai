import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const status = searchParams.get("status");
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));

  if (!clientId || typeof clientId !== "string" || clientId.trim().length === 0) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  try {
    const conditions = [eq(schema.bookings.clientId, clientId)];
    if (status) conditions.push(eq(schema.bookings.status, status));

    const where = and(...conditions);

    const rows = await db
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
      .where(where)
      .orderBy(desc(schema.bookings.scheduledAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({ bookings: rows });
  } catch (err) {
    console.error("[api/bookings] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { leadId, clientId, scheduledAt, durationMin, meetingUrl, notes } = body as {
    leadId?: string;
    clientId?: string;
    scheduledAt?: string;
    durationMin?: number;
    meetingUrl?: string;
    notes?: string;
  };

  if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }
  if (!clientId || typeof clientId !== "string" || clientId.trim().length === 0) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  if (!scheduledAt || isNaN(Date.parse(scheduledAt))) {
    return NextResponse.json({ error: "valid scheduledAt required" }, { status: 400 });
  }

  try {
    const bookingId = randomUUID();

    await db.insert(schema.bookings).values({
      id: bookingId,
      leadId,
      clientId,
      scheduledAt: new Date(scheduledAt),
      durationMin: typeof durationMin === "number" && Number.isFinite(durationMin) ? Math.max(1, Math.floor(durationMin)) : 30,
      meetingUrl: meetingUrl ?? null,
      notes: notes ?? null,
      status: "scheduled",
    });

    await db
      .update(schema.clientLeads)
      .set({ status: "booked" })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

    const [created] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId)).limit(1);

    return NextResponse.json({ booking: created }, { status: 201 });
  } catch (err) {
    console.error("[api/bookings] POST error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
