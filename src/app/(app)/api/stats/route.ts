import { NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { and, sql, eq, desc } from "drizzle-orm";
import { getSession } from "@/backend/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const clientId = session.activeOrganizationId;

    const pipeline = await db
      .select({ status: schema.clientLeads.status, count: sql<number>`count(*)::int` })
      .from(schema.clientLeads)
      .where(eq(schema.clientLeads.clientId, clientId))
      .groupBy(schema.clientLeads.status);

    const bands = await db
      .select({ band: schema.clientLeads.band, count: sql<number>`count(*)::int` })
      .from(schema.clientLeads)
      .where(eq(schema.clientLeads.clientId, clientId))
      .groupBy(schema.clientLeads.band);

    const today = new Date().toISOString().split("T")[0];
    const [kpiRow] = await db.select().from(schema.kpiDaily).where(and(eq(schema.kpiDaily.clientId, clientId), eq(schema.kpiDaily.date, today))).limit(1);
    const totalLeads = await db.select({ count: sql<number>`count(*)::int` }).from(schema.clientLeads).where(eq(schema.clientLeads.clientId, clientId));
    const recentCalls = await db.select().from(schema.calls).where(eq(schema.calls.clientId, clientId)).orderBy(desc(schema.calls.startedAt)).limit(5);
    const activeRetries = await db.select({ count: sql<number>`count(*)::int` }).from(schema.retryQueue).where(and(eq(schema.retryQueue.clientId, clientId), eq(schema.retryQueue.status, "pending")));

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
