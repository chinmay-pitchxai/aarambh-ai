import { db } from "@/backend/db";
import { schema } from "@/backend/db";
import { sql, eq, and, desc } from "drizzle-orm";

// ── Lead Statistics ──
export async function getLeadStats(tenantId: string) {
  const pipeline = await db
    .select({ status: schema.clientLeads.status, count: sql<number>`count(*)::int` })
    .from(schema.clientLeads)
    .where(eq(schema.clientLeads.clientId, tenantId))
    .groupBy(schema.clientLeads.status);

  const bands = await db
    .select({ band: schema.clientLeads.band, count: sql<number>`count(*)::int` })
    .from(schema.clientLeads)
    .where(eq(schema.clientLeads.clientId, tenantId))
    .groupBy(schema.clientLeads.band);

  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clientLeads)
    .where(eq(schema.clientLeads.clientId, tenantId));

  const hotLeads = await db
    .select({
      id: schema.clientLeads.id,
      leadId: schema.clientLeads.leadId,
      score: schema.clientLeads.score,
      band: schema.clientLeads.band,
      status: schema.clientLeads.status,
      firstName: schema.leads.firstName,
      lastName: schema.leads.lastName,
      company: schema.leads.company,
      title: schema.leads.title,
    })
    .from(schema.clientLeads)
    .innerJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id))
    .where(and(eq(schema.clientLeads.clientId, tenantId), eq(schema.clientLeads.band, "hot")))
    .orderBy(desc(schema.clientLeads.score))
    .limit(10);

  return {
    total,
    pipeline: Object.fromEntries(pipeline.map((r) => [r.status || "unknown", r.count])),
    bands: Object.fromEntries(bands.map((r) => [r.band || "unscored", r.count])),
    hotLeads,
  };
}

// ── Call Statistics ──
export async function getCallStats(tenantId: string) {
  const today = new Date().toISOString().split("T")[0];

  const todayKpi = await db
    .select()
    .from(schema.kpiDaily)
    .where(and(eq(schema.kpiDaily.clientId, tenantId), eq(schema.kpiDaily.date, today)))
    .limit(1);

  const totalCalls = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.calls)
    .where(eq(schema.calls.clientId, tenantId));

  const outcomes = await db
    .select({ outcome: schema.calls.outcome, count: sql<number>`count(*)::int` })
    .from(schema.calls)
    .where(eq(schema.calls.clientId, tenantId))
    .groupBy(schema.calls.outcome);

  const avgDuration = await db
    .select({ avg: sql<number>`coalesce(avg(${schema.calls.durationSec}), 0)::int` })
    .from(schema.calls)
    .where(eq(schema.calls.clientId, tenantId));

  const recentCalls = await db
    .select({
      id: schema.calls.id,
      outcome: schema.calls.outcome,
      durationSec: schema.calls.durationSec,
      summary: schema.calls.summary,
      sentiment: schema.calls.sentiment,
      startedAt: schema.calls.startedAt,
      leadFirstName: schema.leads.firstName,
      leadLastName: schema.leads.lastName,
      leadCompany: schema.leads.company,
    })
    .from(schema.calls)
    .leftJoin(schema.leads, eq(schema.calls.leadId, schema.leads.id))
    .where(eq(schema.calls.clientId, tenantId))
    .orderBy(desc(schema.calls.startedAt))
    .limit(10);

  return {
    todayCalls: todayKpi[0]?.callsMade || 0,
    todayAnswered: todayKpi[0]?.callsAnswered || 0,
    totalCalls: totalCalls[0]?.count || 0,
    outcomes: Object.fromEntries(outcomes.map((r) => [r.outcome || "unknown", r.count])),
    avgDurationSec: avgDuration[0]?.avg || 0,
    recentCalls,
  };
}

// ── Meeting Statistics ──
export async function getMeetingStats(tenantId: string) {
  const today = new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();

  const todayKpi = await db
    .select()
    .from(schema.kpiDaily)
    .where(and(eq(schema.kpiDaily.clientId, tenantId), eq(schema.kpiDaily.date, today)))
    .limit(1);

  const totalBooked = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(eq(schema.bookings.clientId, tenantId));

  const upcomingMeetings = await db
    .select({
      id: schema.bookings.id,
      scheduledAt: schema.bookings.scheduledAt,
      durationMin: schema.bookings.durationMin,
      status: schema.bookings.status,
      meetingUrl: schema.bookings.meetingUrl,
      leadFirstName: schema.leads.firstName,
      leadLastName: schema.leads.lastName,
      leadCompany: schema.leads.company,
    })
    .from(schema.bookings)
    .leftJoin(schema.leads, eq(schema.bookings.leadId, schema.leads.id))
    .where(and(eq(schema.bookings.clientId, tenantId), eq(schema.bookings.status, "scheduled")))
    .orderBy(schema.bookings.scheduledAt)
    .limit(10);

  const statusCounts = await db
    .select({ status: schema.bookings.status, count: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(eq(schema.bookings.clientId, tenantId))
    .groupBy(schema.bookings.status);

  return {
    todayBooked: todayKpi[0]?.meetingsBooked || 0,
    totalBooked: totalBooked[0]?.count || 0,
    upcomingMeetings,
    statuses: Object.fromEntries(statusCounts.map((r) => [r.status || "unknown", r.count])),
  };
}

// ── Recent Activity ──
export async function getRecentActivity(tenantId: string, limit = 10) {
  const callsRaw = await db
    .select({
      id: schema.calls.id,
      type: sql<string>`'call'`,
      outcome: schema.calls.outcome,
      durationSec: schema.calls.durationSec,
      summary: schema.calls.summary,
      sentiment: schema.calls.sentiment,
      timestamp: schema.calls.startedAt,
      leadFirstName: schema.leads.firstName,
      leadLastName: schema.leads.lastName,
      leadCompany: schema.leads.company,
    })
    .from(schema.calls)
    .leftJoin(schema.leads, eq(schema.calls.leadId, schema.leads.id))
    .where(eq(schema.calls.clientId, tenantId))
    .orderBy(desc(schema.calls.startedAt))
    .limit(limit);

  const messagesRaw = await db
    .select({
      id: schema.messages.id,
      type: sql<string>`'message'`,
      channel: schema.messages.channel,
      direction: schema.messages.direction,
      body: schema.messages.body,
      timestamp: schema.messages.sentAt,
      leadFirstName: schema.leads.firstName,
      leadLastName: schema.leads.lastName,
      leadCompany: schema.leads.company,
    })
    .from(schema.messages)
    .leftJoin(schema.leads, eq(schema.messages.leadId, schema.leads.id))
    .where(eq(schema.messages.clientId, tenantId))
    .orderBy(desc(schema.messages.sentAt))
    .limit(limit);

  const activity = [...callsRaw, ...messagesRaw]
    .sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())
    .slice(0, limit);

  return { activity };
}

// ── Lead Details ──
export async function getLeadDetails(tenantId: string, leadId: string) {
  const lead = await db
    .select({
      id: schema.clientLeads.id,
      leadId: schema.clientLeads.leadId,
      score: schema.clientLeads.score,
      band: schema.clientLeads.band,
      status: schema.clientLeads.status,
      attemptCount: schema.clientLeads.attemptCount,
      lastCallAt: schema.clientLeads.lastCallAt,
      firstName: schema.leads.firstName,
      lastName: schema.leads.lastName,
      email: schema.leads.email,
      phone: schema.leads.phoneE164,
      company: schema.leads.company,
      title: schema.leads.title,
      city: schema.leads.city,
      industry: schema.leads.industry,
    })
    .from(schema.clientLeads)
    .innerJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id))
    .where(and(eq(schema.clientLeads.clientId, tenantId), eq(schema.clientLeads.id, leadId)))
    .limit(1);

  if (!lead[0]) return null;

  const calls = await db
    .select({
      id: schema.calls.id,
      outcome: schema.calls.outcome,
      durationSec: schema.calls.durationSec,
      summary: schema.calls.summary,
      sentiment: schema.calls.sentiment,
      startedAt: schema.calls.startedAt,
    })
    .from(schema.calls)
    .where(and(eq(schema.calls.clientId, tenantId), eq(schema.calls.leadId, lead[0].leadId)))
    .orderBy(desc(schema.calls.startedAt))
    .limit(5);

  return { ...lead[0], recentCalls: calls };
}
