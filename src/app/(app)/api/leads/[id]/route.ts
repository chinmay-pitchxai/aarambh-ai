import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { and, eq, sql } from "drizzle-orm";
import { getSession } from "@/backend/auth";
import { generateLeadInsights } from "@/backend/services/lead-insights";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const leadId = params.id;

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [clientLead] = await db
    .select()
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, session.activeOrganizationId)))
    .limit(1);

  if (!clientLead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Lead info
  const [lead] = await db
    .select({
      id: schema.leads.id,
      firstName: schema.leads.firstName,
      lastName: schema.leads.lastName,
      email: schema.leads.email,
      phone: schema.leads.phoneE164,
      company: schema.leads.company,
      title: schema.leads.title,
      city: schema.leads.city,
      industry: schema.leads.industry,
      companySize: schema.leads.companySize,
      icpTags: schema.leads.icpTags,
    })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Calls
  const calls = await db
    .select()
    .from(schema.calls)
    .where(and(eq(schema.calls.leadId, leadId), eq(schema.calls.clientId, session.activeOrganizationId)))
    .orderBy(sql`${schema.calls.startedAt} DESC`);

  // Messages
  const messages = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.leadId, leadId), eq(schema.messages.clientId, session.activeOrganizationId)))
    .orderBy(sql`${schema.messages.sentAt} DESC`);

  // Bookings
  const bookings = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.leadId, leadId), eq(schema.bookings.clientId, session.activeOrganizationId)))
    .orderBy(sql`${schema.bookings.scheduledAt} DESC`);

  // Retry queue (next actions)
  const retries = await db
    .select()
    .from(schema.retryQueue)
    .where(and(eq(schema.retryQueue.leadId, leadId), eq(schema.retryQueue.clientId, session.activeOrganizationId), eq(schema.retryQueue.status, "pending")))
    .orderBy(sql`${schema.retryQueue.nextAttemptAt} ASC`)
    .limit(3);

  const leadWithState = {
    ...lead,
    score: clientLead.score ?? null,
    band: clientLead.band ?? null,
    status: clientLead.status ?? null,
    lastCallAt: clientLead.lastCallAt ?? null,
    attemptCount: clientLead.attemptCount ?? 0,
    reusedFrom: clientLead.reusedFrom ?? null,
    assignedAt: clientLead.assignedAt ?? null,
  };
  const insights = await generateLeadInsights({ lead: leadWithState, calls, messages });

  return NextResponse.json({
    lead: leadWithState,
    calls,
    messages,
    bookings,
    retries,
    insights,
  });
}
