import { db } from "@/backend/db";
import { schema } from "@/backend/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { researchCompany } from "./company-research";
import { generateICP, toIcpProfile } from "./icp-generation";
import { searchApolloProspects, type IcpProfile } from "./apollo";

const VOBIZ_API = process.env.VOBIZ_API_URL || "https://api.vobiz.in/v1";

// ── Unified Action Service ──
// Routes chat actions to the right backend and returns structured results

export interface ActionResult {
  success: boolean;
  action: string;
  summary: string;
  data?: Record<string, unknown>;
  error?: string;
}

// ── Analyze Company → Research → ICP → Sample Leads ──

export async function analyzeCompanyAction(
  tenantId: string,
  website: string,
): Promise<ActionResult> {
  try {
    const normalizedWebsite = /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`;
    const url = new URL(normalizedWebsite);
    const companyName = url.hostname.replace(/^www\./, "").split(".")[0];
    const displayName = companyName.charAt(0).toUpperCase() + companyName.slice(1);

    // Step 1: Research company
    const research = await researchCompany(displayName, normalizedWebsite);

    // Step 2: Generate ICP
    const icp = await generateICP(db, tenantId, {
      companyName: research.companyName,
      website: research.website,
      industry: research.industry,
      description: research.description,
      location: "Global",
      products: research.products,
      targetMarket: research.targetMarket,
      category: research.category,
    });

    const icpProfile = toIcpProfile(icp);

    // Step 3: Generate sample leads (3 leads for preview)
    let sampleLeads: Array<{ firstName: string | null; lastName: string | null; company: string | null; title: string | null; email: string | null }> = [];
    try {
      const prospects = await searchApolloProspects(icpProfile, 3);
      sampleLeads = prospects.map((p) => ({
        firstName: p.firstName,
        lastName: p.lastName,
        company: p.company,
        title: p.title,
        email: p.email,
      }));
    } catch {
      // Apollo might not be configured
    }

    return {
      success: true,
      action: "analyzeCompany",
      summary: `Analyzed ${research.companyName}: ${research.description}`,
      data: {
        company: {
          name: research.companyName,
          industry: research.industry,
          category: research.category,
          description: research.description,
          confidenceScore: research.confidenceScore,
        },
        icp: {
          industries: icp.target_industries,
          titles: icp.target_titles,
          seniorities: icp.target_seniorities,
          companySizes: icp.target_company_sizes,
          locations: icp.target_locations,
          keywords: icp.keywords,
        },
        sampleLeads,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, action: "analyzeCompany", summary: "Company analysis failed", error: msg };
  }
}

// ── Search Leads → Apollo → Normalize → Store ──

export async function searchLeadsAction(
  tenantId: string,
  query: string,
  location?: string,
  title?: string,
): Promise<ActionResult> {
  try {
    const icp: IcpProfile = {
      industries: [],
      personTitles: title ? [title] : [],
      seniorities: ["owner", "founder", "c_suite", "vp", "head", "director"],
      employeeRanges: ["11,50", "51,200", "201,500"],
      locations: location ? [location] : [],
      keywords: query ? query.split(/\s+/).filter(Boolean) : [],
    };

    const prospects = await searchApolloProspects(icp, 10);
    const storedLeads: Array<{ id: string; firstName: string | null; company: string | null; title: string | null }> = [];

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
          company: prospect.company,
          title: prospect.title,
        });
      }
    }

    return {
      success: true,
      action: "searchLeads",
      summary: `Found ${prospects.length} leads, stored ${storedLeads.length} new leads`,
      data: {
        query,
        location: location || "Any",
        title: title || "Any",
        totalFound: prospects.length,
        totalNew: storedLeads.length,
        leads: storedLeads,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, action: "searchLeads", summary: "Lead search failed", error: msg };
  }
}

// ── Call Lead → Voice Agent → Initiate Call ──

export async function callLeadAction(
  tenantId: string,
  leadId: string,
): Promise<ActionResult> {
  try {
    // Fetch lead
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);

    if (!lead) return { success: false, action: "callLead", summary: "Lead not found", error: "Lead not found" };
    if (!lead.phoneE164) return { success: false, action: "callLead", summary: "No phone number", error: "No phone number available" };

    // Initiate call via Vobiz
    const apiKey = process.env.VOBIZ_API_KEY;
    let vobizCallId: string;
    let status: string;

    if (!apiKey) {
      vobizCallId = `dev-${randomUUID().slice(0, 8)}`;
      status = "connected";
    } else {
      const res = await fetch(`${VOBIZ_API}/calls`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: lead.phoneE164,
          from: process.env.VOBIZ_FROM_NUMBER,
          webhook: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/vobiz`,
          record: true,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        return { success: false, action: "callLead", summary: "Call failed", error: `Vobiz error: ${res.status} ${errBody}` };
      }

      const data = await res.json();
      vobizCallId = data.call_id;
      status = data.status;
    }

    // Store call record
    const callId = randomUUID();
    await db.insert(schema.calls).values({
      id: callId,
      leadId,
      clientId: tenantId,
      vobizCallId,
      outcome: "no_answer",
      durationSec: 0,
      pitchUsed: "Manual call from dashboard",
      startedAt: new Date(),
      endedAt: new Date(),
    });

    // Update lead status
    await db
      .update(schema.clientLeads)
      .set({ status: "contacted", lastCallAt: new Date() })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, tenantId)));

    return {
      success: true,
      action: "callLead",
      summary: `Calling ${lead.firstName || "lead"} ${lead.lastName || ""} at ${lead.phoneE164}`,
      data: {
        callId,
        leadName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
        phone: lead.phoneE164,
        status,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, action: "callLead", summary: "Call initiation failed", error: msg };
  }
}

// ── Message Lead → WhatsApp/Gmail ──

export async function messageLeadAction(
  tenantId: string,
  leadId: string,
  channel: "whatsapp" | "email",
  message: string,
  subject?: string,
): Promise<ActionResult> {
  try {
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);

    if (!lead) return { success: false, action: "messageLead", summary: "Lead not found", error: "Lead not found" };

    if (channel === "whatsapp") {
      if (!lead.phoneE164) return { success: false, action: "messageLead", summary: "No phone number", error: "No phone number available" };

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

        if (res.ok) {
          const data = await res.json();
          waMessageId = data.messages?.[0]?.id || null;
        }
      } else {
        waMessageId = `wa-stub-${randomUUID().slice(0, 8)}`;
      }

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
        action: "messageLead",
        summary: `WhatsApp sent to ${lead.firstName || "lead"} at ${lead.phoneE164}`,
        data: { channel: "whatsapp", leadName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(), waMessageId },
      };
    }

    if (channel === "email") {
      if (!lead.email) return { success: false, action: "messageLead", summary: "No email address", error: "No email address available" };

      const emailSubject = subject || "Message from AarambhAI";
      const clientId = process.env.GMAIL_CLIENT_ID;
      const clientSecret = process.env.GMAIL_CLIENT_SECRET;
      const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
      let gmailThreadId: string | null = null;

      if (clientId && clientSecret && refreshToken) {
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
            `Subject: ${emailSubject}`,
            "MIME-Version: 1.0",
            'Content-Type: text/html; charset="UTF-8"',
            "",
            message,
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

      await db.insert(schema.messages).values({
        id: randomUUID(),
        leadId,
        clientId: tenantId,
        channel: "gmail",
        direction: "outbound",
        body: `${emailSubject}\n\n${message}`,
        gmailThreadId,
      });

      return {
        success: true,
        action: "messageLead",
        summary: `Email sent to ${lead.firstName || "lead"} at ${lead.email}`,
        data: { channel: "email", leadName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(), gmailThreadId },
      };
    }

    return { success: false, action: "messageLead", summary: "Invalid channel", error: "Channel must be 'whatsapp' or 'email'" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, action: "messageLead", summary: "Message failed", error: msg };
  }
}

// ── Book Meeting → Calendar ──

export async function bookMeetingAction(
  tenantId: string,
  leadId: string,
  dateTime: string,
): Promise<ActionResult> {
  try {
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);

    if (!lead) return { success: false, action: "bookMeeting", summary: "Lead not found", error: "Lead not found" };

    const scheduledAt = new Date(dateTime);
    if (isNaN(scheduledAt.getTime())) {
      return { success: false, action: "bookMeeting", summary: "Invalid date/time", error: "Invalid date/time format" };
    }

    const bookingId = `bk_${randomUUID().slice(0, 12)}`;
    await db.insert(schema.bookings).values({
      id: bookingId,
      leadId,
      clientId: tenantId,
      scheduledAt,
      durationMin: 30,
      status: "scheduled",
      notes: "Booked via dashboard chat",
    });

    // Update lead status
    await db
      .update(schema.clientLeads)
      .set({ status: "booked" })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, tenantId)));

    // Send WhatsApp confirmation
    if (lead.phoneE164) {
      try {
        const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
        const WA_TOKEN = process.env.WHATSAPP_API_TOKEN;
        if (WA_PHONE_ID && WA_TOKEN) {
          await fetch(`https://graph.facebook.com/v19.0/${WA_PHONE_ID}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${WA_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: lead.phoneE164,
              type: "text",
              text: { body: `Hi ${lead.firstName || "there"}, your meeting is confirmed for ${scheduledAt.toLocaleString()}. We look forward to speaking with you!` },
            }),
          });
        }
      } catch {
        // Best-effort
      }
    }

    return {
      success: true,
      action: "bookMeeting",
      summary: `Meeting booked with ${lead.firstName || "lead"} ${lead.lastName || ""} for ${scheduledAt.toLocaleString()}`,
      data: {
        bookingId,
        leadName: `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
        scheduledAt: scheduledAt.toISOString(),
        durationMin: 30,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, action: "bookMeeting", summary: "Booking failed", error: msg };
  }
}
