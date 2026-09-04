import { autoOnboard, type AutoOnboardResult } from "./auto-onboard";
import { searchApolloProspects, type IcpProfile, type ApolloProspect } from "./apollo";
import { db, schema } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";

// ── Action Router ──
// Classifies chat messages into actions and executes them.
// Returns structured data that the chat assistant can present to the user.

export type ActionType =
  | "analyze_company"
  | "find_leads"
  | "call_lead"
  | "send_message"
  | "book_meeting"
  | "get_stats"
  | "update_status"
  | "list_leads"
  | "unknown";

export interface ClassifiedAction {
  type: ActionType;
  confidence: number;
  params: Record<string, unknown>;
}

export interface ActionResult {
  action: ActionType;
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// ── Intent Classification ──

const ACTION_PATTERNS: Array<{ type: ActionType; keywords: string[]; priority: number }> = [
  { type: "analyze_company", keywords: ["analyz", "research", "company", "website", "scrape", "onboard", "setup my", "my company", "acme", ".com", ".io"], priority: 10 },
  { type: "find_leads", keywords: ["find lead", "search lead", "apollo", "prospect", "generate lead", "get lead", "new lead", "pull lead"], priority: 9 },
  { type: "call_lead", keywords: ["call", "phone", "ring", "dial", "voice call", "make a call"], priority: 8 },
  { type: "send_message", keywords: ["send", "message", "whatsapp", "email", "follow up", "follow-up", "outreach"], priority: 7 },
  { type: "book_meeting", keywords: ["book", "meeting", "schedule", "calendar", "demo", "appointment"], priority: 6 },
  { type: "get_stats", keywords: ["stats", "how many", "conversion", "rate", "performance", "metrics", "dashboard", "summary", "overview"], priority: 5 },
  { type: "update_status", keywords: ["status", "update", "qualified", "mark", "set status", "move to"], priority: 4 },
  { type: "list_leads", keywords: ["list lead", "show lead", "my lead", "all lead", "lead list"], priority: 3 },
];

export function classifyIntent(message: string): ClassifiedAction {
  const lower = message.toLowerCase();
  let bestMatch: ClassifiedAction = { type: "unknown", confidence: 0, params: {} };

  for (const pattern of ACTION_PATTERNS) {
    const matchCount = pattern.keywords.filter((kw) => lower.includes(kw)).length;
    if (matchCount === 0) continue;

    const confidence = Math.min(1, matchCount / Math.min(3, pattern.keywords.length));
    const adjustedConfidence = confidence * (pattern.priority / 10);

    if (adjustedConfidence > bestMatch.confidence) {
      bestMatch = { type: pattern.type, confidence: adjustedConfidence, params: {} };
    }
  }

  // Extract parameters from the message
  bestMatch.params = extractParams(bestMatch.type, lower, message);

  return bestMatch;
}

function extractParams(type: ActionType, lower: string, original: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  // Extract company name / website
  const websiteMatch = original.match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
  if (websiteMatch) {
    params.website = websiteMatch[1];
  }

  // Extract location
  const locationPatterns = [
    /(?:in|from|at|located in)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
    /(?:bangalore|bengaluru|mumbai|delhi|chennai|hyderabad|pune|gurgaon|noida|india)/i,
  ];
  for (const pattern of locationPatterns) {
    const match = original.match(pattern);
    if (match) {
      params.location = match[1] || match[0];
      break;
    }
  }

  // Extract role/title
  const titlePatterns = [
    /(?:ceo|cto|cfo|coo|cmo|cro|cio)/i,
    /(?:vp|vice president|director|head|manager|lead|founder|owner)/i,
  ];
  for (const pattern of titlePatterns) {
    const match = original.match(pattern);
    if (match) {
      params.title = match[0];
      break;
    }
  }

  // Extract lead limit
  const limitMatch = original.match(/(\d+)\s*(?:lead|prospect|result)/);
  if (limitMatch) {
    params.limit = parseInt(limitMatch[1], 10);
  }

  // Extract leadId for call/message/status operations
  if (type === "call_lead" || type === "send_message" || type === "update_status") {
    // Look for lead name or ID in the message
    const leadIdMatch = original.match(/lead[_\s]*(?:id)?[_\s]*([a-f0-9-]+)/i);
    if (leadIdMatch) params.leadId = leadIdMatch[1];
  }

  return params;
}

// ── Action Executors ──

export async function executeAction(
  tenantId: string,
  classified: ClassifiedAction,
): Promise<ActionResult> {
  try {
    switch (classified.type) {
      case "analyze_company":
        return await executeAnalyzeCompany(tenantId, classified.params);
      case "find_leads":
        return await executeFindLeads(tenantId, classified.params);
      case "call_lead":
        return await executeCallLead(tenantId, classified.params);
      case "send_message":
        return await executeSendMessage(tenantId, classified.params);
      case "book_meeting":
        return await executeBookMeeting(tenantId, classified.params);
      case "get_stats":
        return await executeGetStats(tenantId);
      case "update_status":
        return await executeUpdateStatus(tenantId, classified.params);
      case "list_leads":
        return await executeListLeads(tenantId, classified.params);
      default:
        return { action: "unknown", success: false, message: "I'm not sure what you'd like me to do. Could you rephrase?" };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[action-router] ${classified.type} failed:`, msg);
    return { action: classified.type, success: false, message: `Action failed: ${msg}` };
  }
}

async function executeAnalyzeCompany(tenantId: string, params: Record<string, unknown>): Promise<ActionResult> {
  const companyName = (params.companyName as string) || (params.website as string)?.split(".")[0] || "Unknown";
  const website = (params.website as string) || "";
  const location = (params.location as string) || "India";

  if (!website) {
    return {
      action: "analyze_company",
      success: false,
      message: "Please provide a website URL to analyze. For example: 'Analyze acme.com'",
    };
  }

  const result: AutoOnboardResult = await autoOnboard(db, {
    tenantId,
    companyName: companyName.charAt(0).toUpperCase() + companyName.slice(1),
    website,
    location,
  });

  const leadCount = result.leads.totalNew;
  const hotLeads = result.sampleLeadDetails.filter((l) => l.band === "hot").length;

  return {
    action: "analyze_company",
    success: true,
    message: `Analyzed ${result.companyProfile.companyName}. Found ${leadCount} leads (${hotLeads} hot). ICP generated with ${result.icp.target_titles.length} target titles.`,
    data: {
      companyProfile: {
        name: result.companyProfile.companyName,
        industry: result.companyProfile.industry,
        description: result.companyProfile.description,
        confidence: result.companyProfile.confidenceScore,
      },
      icp: {
        industries: result.icp.target_industries,
        titles: result.icp.target_titles.slice(0, 5),
        locations: result.icp.target_locations,
      },
      leads: {
        total: leadCount,
        new: result.leads.totalNew,
        duplicate: result.leads.totalDuplicate,
        sampleLeads: result.sampleLeadDetails,
      },
      ragBuilt: result.ragBuilt,
      promptsGenerated: result.promptsGenerated,
    },
  };
}

async function executeFindLeads(tenantId: string, params: Record<string, unknown>): Promise<ActionResult> {
  const location = (params.location as string) || "India";
  const title = (params.title as string) || "CEO";
  const limit = (params.limit as number) || 10;

  // Get existing ICP or build a simple one
  const profile = await db.query.businessProfiles.findFirst({
    where: eq(schema.businessProfiles.organizationId, tenantId),
  });

  const icp: IcpProfile = {
    industries: profile?.industry ? [profile.industry] : [],
    personTitles: [title],
    seniorities: ["owner", "founder", "c_suite", "vp", "head"],
    employeeRanges: ["11,50", "51,200", "201,500"],
    locations: [location],
    keywords: profile?.industry ? profile.industry.split(/\s+/).filter((w) => w.length > 2) : [],
  };

  const prospects = await searchApolloProspects(icp, limit);

  if (prospects.length === 0) {
    return {
      action: "find_leads",
      success: true,
      message: `No leads found for ${title} in ${location}. Try broadening your search criteria.`,
      data: { prospects: [], searched: { title, location, limit } },
    };
  }

  const formatted = prospects.slice(0, 5).map((p: ApolloProspect) => ({
    name: `${p.firstName || ""} ${p.lastName || ""}`.trim() || "Unknown",
    title: p.title || "Unknown",
    company: p.company || "Unknown",
    city: p.city || "Unknown",
    email: p.email || null,
    phone: p.phone ? "Available" : null,
  }));

  return {
    action: "find_leads",
    success: true,
    message: `Found ${prospects.length} leads matching your criteria. Here are the top ${Math.min(5, prospects.length)}:`,
    data: {
      total: prospects.length,
      sample: formatted,
      searched: { title, location, limit },
    },
  };
}

async function executeCallLead(tenantId: string, params: Record<string, unknown>): Promise<ActionResult> {
  const leadId = params.leadId as string | undefined;

  if (!leadId) {
    // Show available leads to call
    const callableLeads = await db
      .select({
        leadId: schema.clientLeads.leadId,
        firstName: schema.leads.firstName,
        lastName: schema.leads.lastName,
        company: schema.leads.company,
        phone: schema.leads.phoneE164,
        status: schema.clientLeads.status,
        score: schema.clientLeads.score,
      })
      .from(schema.clientLeads)
      .innerJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id))
      .where(
        and(
          eq(schema.clientLeads.clientId, tenantId),
          sql`${schema.leads.phoneE164} IS NOT NULL`,
        ),
      )
      .orderBy(desc(schema.clientLeads.score))
      .limit(5);

    if (callableLeads.length === 0) {
      return {
        action: "call_lead",
        success: true,
        message: "No leads with phone numbers available. Generate leads first or add phone numbers.",
        data: { leads: [] },
      };
    }

    const formatted = callableLeads.map((l) => ({
      leadId: l.leadId,
      name: `${l.firstName || ""} ${l.lastName || ""}`.trim() || "Unknown",
      company: l.company || "Unknown",
      phone: l.phone ? "Available" : "No phone",
      status: l.status,
      score: l.score,
    }));

    return {
      action: "call_lead",
      success: true,
      message: `Found ${callableLeads.length} leads ready to call. Specify a leadId to initiate the call.`,
      data: { leads: formatted },
    };
  }

  // Verify lead exists and belongs to tenant
  const [clientLead] = await db
    .select({ leadId: schema.clientLeads.leadId })
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, tenantId)))
    .limit(1);

  if (!clientLead) {
    return { action: "call_lead", success: false, message: "Lead not found for this tenant." };
  }

  // Check phone number
  const [lead] = await db
    .select({ phoneE164: schema.leads.phoneE164, firstName: schema.leads.firstName, lastName: schema.leads.lastName })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead || !lead.phoneE164) {
    return { action: "call_lead", success: false, message: "Lead has no phone number." };
  }

  // Check tenant has a phone number (prefer the user-selected assigned number,
  // falling back to an unassigned pool number for auto-setup flows).
  const [assignedNumber] = await db
    .select({ numberE164: schema.phoneNumbers.numberE164 })
    .from(schema.phoneNumbers)
    .where(and(eq(schema.phoneNumbers.tenantId, tenantId), eq(schema.phoneNumbers.status, "assigned")))
    .limit(1);

  const phoneNumber = assignedNumber?.numberE164
    ? assignedNumber
    : await db
        .select({ numberE164: schema.phoneNumbers.numberE164 })
        .from(schema.phoneNumbers)
        .where(and(eq(schema.phoneNumbers.tenantId, tenantId), eq(schema.phoneNumbers.status, "available")))
        .limit(1)
        .then((rows) => rows[0] || null);

  if (!phoneNumber?.numberE164) {
    return {
      action: "call_lead",
      success: false,
      message: "No phone number provisioned for your account. Contact support to provision one.",
    };
  }

  const name = `${lead.firstName || ""} ${lead.lastName || ""}`.trim() || "Unknown";
  return {
    action: "call_lead",
    success: true,
    message: `Call queued for ${name} (${lead.phoneE164}). The AI voice agent will initiate the call shortly.`,
    data: {
      leadId,
      leadName: name,
      fromNumber: phoneNumber.numberE164,
      toNumber: lead.phoneE164,
      status: "queued",
    },
  };
}

async function executeSendMessage(tenantId: string, params: Record<string, unknown>): Promise<ActionResult> {
  const leadId = params.leadId as string | undefined;
  const channel = (params.channel as string) || "whatsapp";

  if (!leadId) {
    return {
      action: "send_message",
      success: false,
      message: "Please specify which lead to message. For example: 'Send WhatsApp to lead abc123'",
    };
  }

  const [clientLead] = await db
    .select({ leadId: schema.clientLeads.leadId })
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, tenantId)))
    .limit(1);

  if (!clientLead) {
    return { action: "send_message", success: false, message: "Lead not found for this tenant." };
  }

  return {
    action: "send_message",
    success: true,
    message: `Message queued for ${channel}. The AI will compose and send a personalized follow-up.`,
    data: { leadId, channel, status: "queued" },
  };
}

async function executeBookMeeting(tenantId: string, params: Record<string, unknown>): Promise<ActionResult> {
  const leadId = params.leadId as string | undefined;

  if (!leadId) {
    // Show upcoming meetings
    const upcoming = await db
      .select({
        id: schema.bookings.id,
        scheduledAt: schema.bookings.scheduledAt,
        status: schema.bookings.status,
        firstName: schema.leads.firstName,
        lastName: schema.leads.lastName,
        company: schema.leads.company,
      })
      .from(schema.bookings)
      .innerJoin(schema.leads, eq(schema.bookings.leadId, schema.leads.id))
      .where(
        and(
          eq(schema.bookings.clientId, tenantId),
          eq(schema.bookings.status, "scheduled"),
        ),
      )
      .orderBy(schema.bookings.scheduledAt)
      .limit(5);

    if (upcoming.length === 0) {
      return {
        action: "book_meeting",
        success: true,
        message: "No upcoming meetings. Meetings are booked automatically after successful calls.",
        data: { meetings: [] },
      };
    }

    const formatted = upcoming.map((m) => ({
      id: m.id,
      lead: `${m.firstName || ""} ${m.lastName || ""}`.trim() || "Unknown",
      company: m.company || "Unknown",
      scheduledAt: m.scheduledAt?.toISOString(),
      status: m.status,
    }));

    return {
      action: "book_meeting",
      success: true,
      message: `You have ${upcoming.length} upcoming meeting(s):`,
      data: { meetings: formatted },
    };
  }

  return {
    action: "book_meeting",
    success: true,
    message: "Meeting booking will be handled by the voice agent after a successful call.",
    data: { leadId, status: "pending_call" },
  };
}

async function executeGetStats(tenantId: string): Promise<ActionResult> {
  const today = new Date().toISOString().split("T")[0];

  const [leadCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clientLeads)
    .where(eq(schema.clientLeads.clientId, tenantId));

  const [callCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.calls)
    .where(eq(schema.calls.clientId, tenantId));

  const [meetingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.bookings)
    .where(eq(schema.bookings.clientId, tenantId));

  const [hotLeads] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.clientId, tenantId), eq(schema.clientLeads.band, "hot")));

  const [qualifiedLeads] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.clientId, tenantId), eq(schema.clientLeads.status, "qualified")));

  const [bookedLeads] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.clientLeads)
    .where(and(eq(schema.clientLeads.clientId, tenantId), eq(schema.clientLeads.status, "booked")));

  const todayKpi = await db.query.kpiDaily.findFirst({
    where: and(eq(schema.kpiDaily.clientId, tenantId), eq(schema.kpiDaily.date, today)),
  });

  const totalLeads = leadCount?.count || 0;
  const conversionRate = totalLeads > 0 ? Math.round(((bookedLeads?.count || 0) / totalLeads) * 100) : 0;

  return {
    action: "get_stats",
    success: true,
    message: `Your pipeline: ${totalLeads} leads, ${callCount?.count || 0} calls, ${meetingCount?.count || 0} meetings. Conversion rate: ${conversionRate}%.`,
    data: {
      leads: { total: totalLeads, hot: hotLeads?.count || 0, qualified: qualifiedLeads?.count || 0, booked: bookedLeads?.count || 0 },
      calls: { total: callCount?.count || 0, today: todayKpi?.callsMade || 0, answered: todayKpi?.callsAnswered || 0 },
      meetings: { total: meetingCount?.count || 0, today: todayKpi?.meetingsBooked || 0 },
      conversionRate,
      today: {
        leadsPulled: todayKpi?.leadsPulled || 0,
        callsMade: todayKpi?.callsMade || 0,
        meetingsBooked: todayKpi?.meetingsBooked || 0,
      },
    },
  };
}

async function executeUpdateStatus(tenantId: string, params: Record<string, unknown>): Promise<ActionResult> {
  const leadId = params.leadId as string | undefined;
  const newStatus = params.status as string | undefined;

  if (!leadId || !newStatus) {
    return {
      action: "update_status",
      success: false,
      message: "Please specify the lead ID and new status. For example: 'Mark lead abc123 as qualified'",
    };
  }

  const validStatuses = ["new", "contacted", "qualified", "converted", "booked", "parked", "dnc", "lost"];
  if (!validStatuses.includes(newStatus)) {
    return {
      action: "update_status",
      success: false,
      message: `Invalid status. Valid statuses: ${validStatuses.join(", ")}`,
    };
  }

  const [updated] = await db
    .update(schema.clientLeads)
    .set({ status: newStatus as typeof schema.clientLeads.status.enumValues[number] })
    .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, tenantId)))
    .returning({ leadId: schema.clientLeads.leadId });

  if (!updated) {
    return { action: "update_status", success: false, message: "Lead not found for this tenant." };
  }

  return {
    action: "update_status",
    success: true,
    message: `Lead ${leadId} status updated to "${newStatus}".`,
    data: { leadId, status: newStatus },
  };
}

async function executeListLeads(tenantId: string, params: Record<string, unknown>): Promise<ActionResult> {
  const limit = Math.min(50, (params.limit as number) || 10);

  const leads = await db
    .select({
      leadId: schema.clientLeads.leadId,
      firstName: schema.leads.firstName,
      lastName: schema.leads.lastName,
      company: schema.leads.company,
      title: schema.leads.title,
      city: schema.leads.city,
      industry: schema.leads.industry,
      score: schema.clientLeads.score,
      band: schema.clientLeads.band,
      status: schema.clientLeads.status,
    })
    .from(schema.clientLeads)
    .innerJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id))
    .where(eq(schema.clientLeads.clientId, tenantId))
    .orderBy(desc(schema.clientLeads.score))
    .limit(limit);

  if (leads.length === 0) {
    return {
      action: "list_leads",
      success: true,
      message: "No leads found. Use 'analyze company' to generate your first leads.",
      data: { leads: [] },
    };
  }

  const formatted = leads.map((l) => ({
    leadId: l.leadId,
    name: `${l.firstName || ""} ${l.lastName || ""}`.trim() || "Unknown",
    company: l.company || "Unknown",
    title: l.title || "Unknown",
    city: l.city || "Unknown",
    score: l.score ?? 0,
    band: l.band ?? "unscored",
    status: l.status ?? "new",
  }));

  return {
    action: "list_leads",
    success: true,
    message: `Showing ${leads.length} leads (sorted by score):`,
    data: { leads: formatted },
  };
}
