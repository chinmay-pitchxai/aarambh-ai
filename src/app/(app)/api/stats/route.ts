import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { sql, eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get("clientId");

    // Pipeline counts — optionally scoped to client
    const pipelineQuery = db
      .select({ status: schema.clientLeads.status, count: sql<number>`count(*)::int` })
      .from(schema.clientLeads)
      .groupBy(schema.clientLeads.status);
    const pipeline = clientId
      ? await pipelineQuery.where(eq(schema.clientLeads.clientId, clientId))
      : await pipelineQuery;

    // Band distribution
    const bandsQuery = db
      .select({ band: schema.clientLeads.band, count: sql<number>`count(*)::int` })
      .from(schema.clientLeads)
      .groupBy(schema.clientLeads.band);
    const bands = clientId
      ? await bandsQuery.where(eq(schema.clientLeads.clientId, clientId))
      : await bandsQuery;

    // Today's stats
    const today = new Date().toISOString().split("T")[0];
    const todayKpi = clientId
      ? await db.select().from(schema.kpiDaily).where(eq(schema.kpiDaily.clientId, clientId)).limit(1)
      : await db.select().from(schema.kpiDaily).where(eq(schema.kpiDaily.date, today)).limit(1);

    // Filter kpi by date + clientId if both present — for client scoped, pick latest
    const kpiRow = clientId
      ? todayKpi.find((r) => r.date === today) || todayKpi[0]
      : todayKpi[0];

    // Total leads — filtered by client if scoped
    const totalLeads = clientId
      ? await db.select({ count: sql<number>`count(*)::int` }).from(schema.clientLeads).where(eq(schema.clientLeads.clientId, clientId))
      : await db.select({ count: sql<number>`count(*)::int` }).from(schema.leads);

    // Recent calls — filtered if clientId
    const recentCalls = clientId
      ? await db.select().from(schema.calls).where(eq(schema.calls.clientId, clientId)).orderBy(desc(schema.calls.startedAt)).limit(5)
      : await db.select().from(schema.calls).orderBy(desc(schema.calls.startedAt)).limit(5);

    // Active retries
    const activeRetries = clientId
      ? await db.select({ count: sql<number>`count(*)::int` }).from(schema.retryQueue).where(eq(schema.retryQueue.clientId, clientId))
      : await db.select({ count: sql<number>`count(*)::int` }).from(schema.retryQueue).where(eq(schema.retryQueue.status, "pending"));

    const stats = {
      pipeline: Object.fromEntries(pipeline.map((r) => [r.status || "unknown", r.count])),
      bands: Object.fromEntries(bands.map((r) => [r.band || "unscored", r.count])),
      totalLeads: totalLeads[0]?.count || 0,
      activeRetries: activeRetries[0]?.count || 0,
      today: {
        callsMade: kpiRow?.callsMade || 0,
        meetingsBooked: kpiRow?.meetingsBooked || 0,
        costApollo: kpiRow?.costApollo || 0,
        costVobiz: kpiRow?.costVobiz || 0,
      },
      recentCalls,
    };

    return NextResponse.json(stats);
  } catch (err) {
    console.error("[api/stats] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
