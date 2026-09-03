import { db } from "@/backend/db";
import { schema } from "@/backend/db";
import { sql, eq, and, desc } from "drizzle-orm";
import { searchApolloProspects, type IcpProfile } from "../services/apollo";
import { researchCompany } from "../services/company-research";
import { generateICP as genICP, toIcpProfile } from "../services/icp-generation";
import { randomUUID } from "crypto";

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

// ── Search Apollo Leads ──
export async function searchApolloLeads(
  tenantId: string,
  query: string,
  location?: string,
  title?: string,
) {
  const icp: IcpProfile = {
    industries: [],
    personTitles: title ? [title] : [],
    seniorities: ["owner", "founder", "c_suite", "vp", "head", "director"],
    employeeRanges: ["11,50", "51,200", "201,500"],
    locations: location ? [location] : [],
    keywords: query ? query.split(/\s+/).filter(Boolean) : [],
  };

  const prospects = await searchApolloProspects(icp, 10);

  // Store leads in DB
  const storedLeads: Array<{ id: string; firstName: string | null; lastName: string | null; company: string | null; title: string | null; email: string | null; phone: string | null }> = [];

  for (const prospect of prospects) {
    const leadId = randomUUID();
    const existing = prospect.phone
      ? await db.select().from(schema.leads).where(eq(schema.leads.phoneE164, prospect.phone)).limit(1)
      : [];

    if (existing.length === 0) {
      await db.insert(schema.leads).values({
        id: leadId,
        phoneE164: prospect.phone,
        email: prospect.email,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        company: prospect.company,
        title: prospect.title,
        city: prospect.city,
        industry: prospect.industry,
        companySize: prospect.companySize,
        sourceRef: prospect.id,
        sourceCost: 100,
        rawData: prospect.raw,
        freshness: new Date(),
      });

      await db.insert(schema.clientLeads).values({
        id: randomUUID(),
        clientId: tenantId,
        leadId,
        score: 50,
        band: "warm",
        status: "new",
      });

      storedLeads.push({
        id: leadId,
        firstName: prospect.firstName,
        lastName: prospect.lastName,
        company: prospect.company,
        title: prospect.title,
        email: prospect.email,
        phone: prospect.phone,
      });
    }
  }

  return {
    searched: query,
    totalFound: prospects.length,
    totalNew: storedLeads.length,
    leads: storedLeads,
  };
}

// ── Generate Leads from ICP ──
export async function generateLeadsFromICPAction(
  tenantId: string,
  icp: IcpProfile,
  batchSize = 10,
) {
  const prospects = await searchApolloProspects(icp, batchSize);
  const leadIds: string[] = [];
  let totalNew = 0;

  for (const prospect of prospects) {
    const leadId = randomUUID();
    const phone = prospect.phone;

    const existing = phone
      ? await db.select().from(schema.leads).where(eq(schema.leads.phoneE164, phone)).limit(1)
      : [];

    if (existing.length > 0) continue;

    if (prospect.email) {
      const emailMatch = await db.select().from(schema.leads).where(eq(schema.leads.email, prospect.email)).limit(1);
      if (emailMatch.length > 0) continue;
    }

    await db.insert(schema.leads).values({
      id: leadId,
      phoneE164: phone,
      email: prospect.email,
      firstName: prospect.firstName,
      lastName: prospect.lastName,
      company: prospect.company,
      title: prospect.title,
      city: prospect.city,
      industry: prospect.industry,
      companySize: prospect.companySize,
      sourceRef: prospect.id,
      sourceCost: 100,
      rawData: prospect.raw,
      freshness: new Date(),
    });

    await db.insert(schema.clientLeads).values({
      id: randomUUID(),
      clientId: tenantId,
      leadId,
      score: 50,
      band: "warm",
      status: "new",
    });

    leadIds.push(leadId);
    totalNew++;
  }

  return { totalFound: prospects.length, totalNew, leadIds };
}

// ── Initiate Voice Call ──
export async function initiateCall(
  tenantId: string,
  leadId: string,
  phoneNumber?: string,
) {
  // Fetch lead to get phone number
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead && !phoneNumber) {
    return { success: false, error: "Lead not found and no phone number provided" };
  }

  const phone = phoneNumber || lead?.phoneE164;
  if (!phone) {
    return { success: false, error: "No phone number available for this lead" };
  }

  // Submit a REAL call via the Vobiz adapter. The terminal outcome arrives
  // via the provider status/hangup callback — never fabricated here.
  const { requireVobizConfig } = await import("../config");
  const { getVobizClient } = await import("../integrations/vobiz");
  const { fromNumber } = requireVobizConfig();
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/v1/webhooks/vobiz`;

  let callId: string;
  let status: string;
  try {
    const result = await getVobizClient().initiateCall(fromNumber, phone, webhookUrl, {
      timeout: 30,
      callbackUrl: webhookUrl,
    });
    callId = result.callId;
    status = result.status;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Vobiz dial failed: ${msg}` };
  }

  // Store pending call record (outcome filled in by webhook flow)
  const callIdDb = randomUUID();
  await db.insert(schema.calls).values({
    id: callIdDb,
    leadId: lead?.id || leadId,
    clientId: tenantId,
    vobizCallId: callId,
    outcome: null,
    durationSec: null,
    pitchUsed: "Manual call initiation from dashboard",
    summary: `Manual call submitted (provider uuid ${callId}). Awaiting provider outcome via webhook.`,
    startedAt: new Date(),
  });

  return {
    success: true,
    callId: callIdDb,
    vobizCallId: callId,
    status,
    leadName: lead ? `${lead.firstName || ""} ${lead.lastName || ""}`.trim() : "Unknown",
    phone,
  };
}

// ── Send WhatsApp Message ──
export async function sendWhatsApp(
  tenantId: string,
  leadId: string,
  message: string,
) {
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) return { success: false, error: "Lead not found" };
  if (!lead.phoneE164) return { success: false, error: "No phone number for this lead" };

  const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  const WA_TOKEN = process.env.WHATSAPP_API_TOKEN;
  let waMessageId: string | null = null;

  if (WA_PHONE_ID && WA_TOKEN) {
    const res = await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: lead.phoneE164,
        type: "text",
        text: { body: message },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { success: false, error: `WhatsApp send failed: ${res.status} ${errBody}` };
    }

    const data = await res.json();
    waMessageId = data.messages?.[0]?.id || null;
  } else {
    waMessageId = `wa-stub-${randomUUID().slice(0, 8)}`;
  }

  // Store message
  await db.insert(schema.messages).values({
    id: randomUUID(),
    leadId,
    clientId: tenantId,
    channel: "whatsapp",
    direction: "outbound",
    body: message,
    waMessageId,
  });

  return {
    success: true,
    waMessageId,
    leadName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
    phone: lead.phoneE164,
  };
}

// ── Send Email ──
export async function sendEmail(
  tenantId: string,
  leadId: string,
  subject: string,
  body: string,
) {
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) return { success: false, error: "Lead not found" };
  if (!lead.email) return { success: false, error: "No email address for this lead" };

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  let gmailThreadId: string | null = null;

  if (clientId && clientSecret && refreshToken) {
    // Refresh token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (tokenRes.ok) {
      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      const mimeMessage = [
        `To: ${lead.email}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        'Content-Type: text/html; charset="UTF-8"',
        "",
        body,
      ].join("\r\n");

      const encodedMessage = Buffer.from(mimeMessage)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encodedMessage }),
      });

      if (sendRes.ok) {
        const sendData = await sendRes.json();
        gmailThreadId = sendData.id || null;
      }
    }
  } else {
    gmailThreadId = `gmail-stub-${randomUUID().slice(0, 8)}`;
  }

  // Store message
  await db.insert(schema.messages).values({
    id: randomUUID(),
    leadId,
    clientId: tenantId,
    channel: "gmail",
    direction: "outbound",
    body: `${subject}\n\n${body}`,
    gmailThreadId,
  });

  return {
    success: true,
    gmailThreadId,
    leadName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
    email: lead.email,
  };
}

// ── Book Meeting ──
export async function bookMeeting(
  tenantId: string,
  leadId: string,
  dateTime: string,
) {
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) return { success: false, error: "Lead not found" };

  const scheduledAt = new Date(dateTime);
  if (isNaN(scheduledAt.getTime())) {
    return { success: false, error: "Invalid date/time format" };
  }

  const bookingId = `bk_${randomUUID().slice(0, 12)}`;
  await db.insert(schema.bookings).values({
    id: bookingId,
    leadId,
    clientId: tenantId,
    scheduledAt,
    durationMin: 30,
    status: "scheduled",
    notes: `Booked via dashboard chat`,
  });

  // Update lead status
  await db
    .update(schema.clientLeads)
    .set({ status: "booked" })
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, tenantId)));

  // Send WhatsApp confirmation if possible
  if (lead.phoneE164) {
    try {
      await sendWhatsApp(tenantId, leadId, `Hi ${lead.firstName || "there"}, your meeting is confirmed for ${scheduledAt.toLocaleString()}. We look forward to speaking with you!`);
    } catch {
      // WhatsApp send is best-effort
    }
  }

  return {
    success: true,
    bookingId,
    leadName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
    scheduledAt: scheduledAt.toISOString(),
    durationMin: 30,
  };
}

// ── Analyze Company ──
export async function analyzeCompany(tenantId: string, website: string) {
  const normalizedWebsite = /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`;
  const url = new URL(normalizedWebsite);
  const companyName = url.hostname.replace(/^www\./, "").split(".")[0];
  const displayName = companyName.charAt(0).toUpperCase() + companyName.slice(1);

  const result = await researchCompany(displayName, normalizedWebsite);

  return {
    companyName: result.companyName,
    website: result.website,
    description: result.description,
    category: result.category,
    industry: result.industry,
    products: result.products,
    services: result.services,
    targetMarket: result.targetMarket,
    confidenceScore: result.confidenceScore,
  };
}

// ── Generate ICP ──
export async function generateICPFromProfile(
  tenantId: string,
  profile: {
    companyName: string;
    website: string;
    industry: string;
    description: string;
    location: string;
  },
) {
  const icp = await genICP(db, tenantId, {
    companyName: profile.companyName,
    website: profile.website,
    industry: profile.industry,
    description: profile.description,
    location: profile.location,
  });

  return {
    target_industries: icp.target_industries,
    target_titles: icp.target_titles,
    target_seniorities: icp.target_seniorities,
    target_company_sizes: icp.target_company_sizes,
    target_locations: icp.target_locations,
    keywords: icp.keywords,
  };
}

// ── Update Lead Status ──
export async function updateLeadStatus(
  tenantId: string,
  leadId: string,
  status: string,
) {
  const validStatuses = ["new", "contacted", "qualified", "converted", "booked", "parked", "dnc", "lost"];
  if (!validStatuses.includes(status)) {
    return { success: false, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` };
  }

  const [existing] = await db
    .select()
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.clientId, tenantId), eq(schema.clientLeads.id, leadId)))
    .limit(1);

  if (!existing) return { success: false, error: "Lead not found in your pipeline" };

  await db
    .update(schema.clientLeads)
    .set({ status: status as typeof schema.clientLeads.status.enumValues[number] })
    .where(and(eq(schema.clientLeads.clientId, tenantId), eq(schema.clientLeads.id, leadId)));

  return { success: true, leadId, previousStatus: existing.status, newStatus: status };
}
