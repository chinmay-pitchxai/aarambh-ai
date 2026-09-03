import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { getAvailableSlots } from "@/backend/services/calendar-composio";

// GET /api/v1/calendar/slots?date=2026-09-04&duration=30
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const durationParam = searchParams.get("duration");

  if (!dateParam) {
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  const date = new Date(dateParam);
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const duration = durationParam && /^\d+$/.test(durationParam)
    ? Math.max(15, Math.floor(Number(durationParam)))
    : 30;

  try {
    const slots = await getAvailableSlots(auth.ctx.tenantId, date, duration);
    return NextResponse.json({
      slots: slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[api/v1/calendar/slots] GET error", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    if (/not connected/i.test(message)) {
      return NextResponse.json({ error: message, action: "connect" }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
