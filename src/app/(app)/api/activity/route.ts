import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { sql, eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = parseInt(searchParams.get("limit") || "50");
  const type = searchParams.get("type"); // "call" | "message" | null

  const callsRaw = type !== "message"
    ? await db
        .select({
          id: schema.calls.id,
          type: sql<string>`'call'`,
          leadId: schema.calls.leadId,
          clientId: schema.calls.clientId,
          outcome: schema.calls.outcome,
          durationSec: schema.calls.durationSec,
          summary: schema.calls.summary,
          sentiment: schema.calls.sentiment,
          recordingUrl: sql<string>`null`,
          timestamp: schema.calls.startedAt,
          leadFirstName: schema.leads.firstName,
          leadLastName: schema.leads.lastName,
          leadCompany: schema.leads.company,
          leadBand: schema.clientLeads.band,
          leadScore: schema.clientLeads.score,
        })
        .from(schema.calls)
        .leftJoin(schema.leads, eq(schema.calls.leadId, schema.leads.id))
        .leftJoin(schema.clientLeads, eq(schema.calls.leadId, schema.clientLeads.leadId))
        .orderBy(sql`${schema.calls.startedAt} DESC`)
        .limit(limit)
    : [];

  const messagesRaw = type !== "call"
    ? await db
        .select({
          id: schema.messages.id,
          type: sql<string>`'message'`,
          leadId: schema.messages.leadId,
          clientId: schema.messages.clientId,
          channel: schema.messages.channel,
          direction: schema.messages.direction,
          body: schema.messages.body,
          timestamp: schema.messages.sentAt,
          leadFirstName: schema.leads.firstName,
          leadLastName: schema.leads.lastName,
          leadCompany: schema.leads.company,
          leadBand: schema.clientLeads.band,
          leadScore: schema.clientLeads.score,
        })
        .from(schema.messages)
        .leftJoin(schema.leads, eq(schema.messages.leadId, schema.leads.id))
        .leftJoin(schema.clientLeads, eq(schema.messages.leadId, schema.clientLeads.leadId))
        .orderBy(sql`${schema.messages.sentAt} DESC`)
        .limit(limit)
    : [];

  const activity = [...callsRaw, ...messagesRaw]
    .sort((a, b) => new Date(b.timestamp!).getTime() - new Date(a.timestamp!).getTime())
    .slice(0, limit);

  const totalCalls = callsRaw.length;
  const totalMessages = messagesRaw.length;

  return NextResponse.json({ activity, totalCalls, totalMessages });
}
