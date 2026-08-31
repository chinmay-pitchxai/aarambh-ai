import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const leadId = params.id;

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

  // Client lead info (score, band, status) — needs clientId filter; for now pick first
  // TODO: pass clientId via auth header and filter: and(eq(leadId, leadId), eq(clientId, authClientId))
  const [clientLead] = await db
    .select()
    .from(schema.clientLeads)
    .where(eq(schema.clientLeads.leadId, leadId))
    .limit(1);

  // enforce client scoping on calls/messages via clientLeads join when auth is available

  // Calls
  const calls = await db
    .select()
    .from(schema.calls)
    .where(eq(schema.calls.leadId, leadId))
    .orderBy(sql`${schema.calls.startedAt} DESC`);

  // Messages
  const messages = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.leadId, leadId))
    .orderBy(sql`${schema.messages.sentAt} DESC`);

  return NextResponse.json({
    lead: {
      ...lead,
      score: clientLead?.score ?? null,
      band: clientLead?.band ?? null,
      status: clientLead?.status ?? null,
    },
    calls,
    messages,
  });
}
