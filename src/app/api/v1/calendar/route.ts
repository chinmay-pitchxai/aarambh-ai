import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/backend/auth/middleware";
import {
  getUpcomingMeetings,
  createMeeting,
  cancelMeeting,
  type CreateEventInput,
} from "@/backend/services/calendar-composio";

// GET /api/v1/calendar — list upcoming meetings from Google Calendar
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const meetings = await getUpcomingMeetings(auth.ctx.tenantId);
    return NextResponse.json({ meetings });
  } catch (err) {
    console.error("[api/v1/calendar] GET error", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/v1/calendar — create a Google Calendar event
export async function POST(req: NextRequest) {
  const auth = await requireRole("member");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, start, end, attendees, description, timezone } = body as {
    title?: string;
    start?: string;
    end?: string;
    attendees?: string[];
    description?: string;
    timezone?: string;
  };

  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (!start || isNaN(Date.parse(start))) {
    return NextResponse.json({ error: "valid start (ISO) required" }, { status: 400 });
  }
  if (!end || isNaN(Date.parse(end))) {
    return NextResponse.json({ error: "valid end (ISO) required" }, { status: 400 });
  }

  const input: CreateEventInput = {
    title,
    start: new Date(start),
    end: new Date(end),
    attendees: Array.isArray(attendees) ? attendees : [],
    description,
    timezone,
  };

  try {
    const event = await createMeeting(auth.ctx.tenantId, input);
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    console.error("[api/v1/calendar] POST error", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/v1/calendar?eventId=... — cancel a Google Calendar event
export async function DELETE(req: NextRequest) {
  const auth = await requireRole("member");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("eventId");

  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  try {
    const result = await cancelMeeting(auth.ctx.tenantId, eventId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/v1/calendar] DELETE error", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
