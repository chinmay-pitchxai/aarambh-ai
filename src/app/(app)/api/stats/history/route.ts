import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { sql, eq, gte, lte, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") || "30")));
  const clientId = searchParams.get("clientId");

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split("T")[0];

  const whereClient = clientId ? eq(schema.kpiDaily.clientId, clientId) : undefined;
  const whereDate = gte(schema.kpiDaily.date, startDateStr);
  const where = whereClient ? sql`${whereClient} AND ${whereDate}` : whereDate;

  const kpi = await db
    .select()
    .from(schema.kpiDaily)
    .where(where)
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
    .where(
      clientId
        ? sql`${eq(schema.calls.clientId, clientId)} AND ${gte(schema.calls.startedAt, startDate)}`
        : gte(schema.calls.startedAt, startDate)
    )
    .orderBy(desc(schema.calls.startedAt));

  // Daily leads added
  const leads = await db
    .select({
      date: schema.clientLeads.assignedAt,
      band: schema.clientLeads.band,
    })
    .from(schema.clientLeads)
    .where(
      clientId
        ? sql`${eq(schema.clientLeads.clientId, clientId)} AND ${gte(schema.clientLeads.assignedAt, startDate)}`
        : gte(schema.clientLeads.assignedAt, startDate)
    )
    .orderBy(desc(schema.clientLeads.assignedAt));

  return NextResponse.json({ kpi, calls, leads });
}