import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { and, eq, gte, desc } from "drizzle-orm";
import { getSession } from "@/backend/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") || "30")));
  const clientId = session.activeOrganizationId;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split("T")[0];

  const kpi = await db
    .select()
    .from(schema.kpiDaily)
    .where(and(eq(schema.kpiDaily.clientId, clientId), gte(schema.kpiDaily.date, startDateStr)))
    .orderBy(schema.kpiDaily.date);

  // Daily calls with outcomes
  const calls = await db
    .select({
      date: schema.calls.startedAt,
      outcome: schema.calls.outcome,
      durationSec: schema.calls.durationSec,
      sentiment: schema.calls.sentiment,
    })
    .from(schema.calls)
    .where(and(eq(schema.calls.clientId, clientId), gte(schema.calls.startedAt, startDate)))
    .orderBy(desc(schema.calls.startedAt));

  // Daily leads added
  const leads = await db
    .select({
      date: schema.clientLeads.assignedAt,
      band: schema.clientLeads.band,
    })
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.clientId, clientId), gte(schema.clientLeads.assignedAt, startDate)))
    .orderBy(desc(schema.clientLeads.assignedAt));

  return NextResponse.json({ kpi, calls, leads });
}
