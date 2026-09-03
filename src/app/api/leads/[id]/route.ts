import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { schema } from "@/backend/db";
import { eq, and } from "drizzle-orm";
import { generateLeadInsights } from "@/backend/services/lead-insights";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const leadId = params.id;

  try {
    // Get the client-lead record
    const [clientLead] = await db
      .select({
        id: schema.clientLeads.id,
        leadId: schema.clientLeads.leadId,
        score: schema.clientLeads.score,
        band: schema.clientLeads.band,
        status: schema.clientLeads.status,
        reusedFrom: schema.clientLeads.reusedFrom,
        assignedAt: schema.clientLeads.assignedAt,
        attemptCount: schema.clientLeads.attemptCount,
        lastCallAt: schema.clientLeads.lastCallAt,
      })
      .from(schema.clientLeads)
      .where(
        and(
          eq(schema.clientLeads.leadId, leadId),
          eq(schema.clientLeads.clientId, auth.ctx.tenantId),
        ),
      )
      .limit(1);

    if (!clientLead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Get the mother lead record
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);

    if (!lead) {
      return NextResponse.json({ error: "Lead data not found" }, { status: 404 });
    }

    // Get calls
    const calls = await db
      .select()
      .from(schema.calls)
      .where(
        and(
          eq(schema.calls.leadId, leadId),
          eq(schema.calls.clientId, auth.ctx.tenantId),
        ),
      )
      .orderBy(schema.calls.startedAt);

    // Get messages
    const messages = await db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.leadId, leadId),
          eq(schema.messages.clientId, auth.ctx.tenantId),
        ),
      )
      .orderBy(schema.messages.sentAt);

    // Get bookings
    const bookings = await db
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.leadId, leadId),
          eq(schema.bookings.clientId, auth.ctx.tenantId),
        ),
      )
      .orderBy(schema.bookings.scheduledAt);

    // Get retries
    const retries = await db
      .select()
      .from(schema.retryQueue)
      .where(
        and(
          eq(schema.retryQueue.leadId, leadId),
          eq(schema.retryQueue.clientId, auth.ctx.tenantId),
        ),
      )
      .orderBy(schema.retryQueue.createdAt);

    // Generate insights
    let insights = null;
    try {
      insights = await generateLeadInsights({
        lead: {
          firstName: lead.firstName,
          company: lead.company,
          title: lead.title,
          status: clientLead.status ?? "new",
          band: clientLead.band ?? "cold",
        },
        calls: calls.map((c) => ({
          outcome: c.outcome ?? "unknown",
          summary: c.summary ?? undefined,
          sentiment: c.sentiment ?? undefined,
        })),
        messages: messages.map((m) => ({
          channel: m.channel,
          direction: m.direction,
          body: m.body ?? undefined,
        })),
      });
    } catch (err) {
      console.error("[api/leads/[id]] insights generation failed", err);
    }

    return NextResponse.json({
      lead: {
        id: lead.id,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: lead.phoneE164,
        company: lead.company,
        title: lead.title,
        city: lead.city,
        industry: lead.industry,
        companySize: lead.companySize,
        score: clientLead.score,
        band: clientLead.band,
        status: clientLead.status,
        icpTags: lead.icpTags,
        lastCallAt: clientLead.lastCallAt?.toISOString() ?? null,
        attemptCount: clientLead.attemptCount ?? 0,
        reusedFrom: clientLead.reusedFrom,
        assignedAt: clientLead.assignedAt?.toISOString() ?? null,
      },
      calls: calls.map((c) => ({
        id: c.id,
        outcome: c.outcome,
        durationSec: c.durationSec,
        summary: c.summary,
        sentiment: c.sentiment,
        transcript: c.transcript,
        bant: c.bant,
        recordingUrl: c.recordingUrl,
        startedAt: c.startedAt?.toISOString() ?? new Date().toISOString(),
      })),
      messages: messages.map((m) => ({
        id: m.id,
        channel: m.channel,
        direction: m.direction,
        body: m.body,
        sentAt: m.sentAt?.toISOString() ?? new Date().toISOString(),
      })),
      bookings: bookings.map((b) => ({
        id: b.id,
        scheduledAt: b.scheduledAt.toISOString(),
        durationMin: b.durationMin,
        status: b.status,
        meetingUrl: b.meetingUrl,
        notes: b.notes,
      })),
      retries: retries.map((r) => ({
        id: r.id,
        attempt: r.attempt,
        reason: r.reason,
        nextAttemptAt: r.nextAttemptAt?.toISOString() ?? new Date().toISOString(),
      })),
      insights,
    });
  } catch (err) {
    console.error("[api/leads/[id]] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
