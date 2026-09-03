import { NextRequest, NextResponse } from "next/server";
import { db } from "@/backend/db";
import { getAvailableSlots } from "@/backend/calendar/service";
import { requireAuth } from "@/backend/auth/middleware";

// GET /api/v1/meetings/available-slots?start=&end=&duration=
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const durationParam = searchParams.get("duration");

  const now = new Date();
  const startDate = startParam && !isNaN(Date.parse(startParam)) ? new Date(startParam) : now;
  const endDate = endParam && !isNaN(Date.parse(endParam)) ? new Date(endParam) : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const duration = durationParam && /^\d+$/.test(durationParam) ? Math.max(1, Math.floor(Number(durationParam))) : 30;

  try {
    const slots = await getAvailableSlots(db, {
      tenantId: auth.ctx.tenantId,
      startDate,
      endDate,
      durationMin: duration,
    });
    return NextResponse.json({
      slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    });
  } catch (err) {
    console.error("[api/v1/meetings/available-slots] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}