import type { IcpProfile } from "../services/apollo";

export function COMPANY_RESEARCH_PROMPT(context: {
  companyName: string;
  website: string;
  location: string;
  websiteMetadata?: Record<string, string>;
  apolloOrganization?: {
    industry?: string;
    shortDescription?: string;
    estimatedNumEmployees?: number;
    city?: string;
    state?: string;
    country?: string;
  } | null;
}): string {
  const parts: string[] = [
    `Research the following business and return structured company information.`,
    ``,
    `Company: ${context.companyName}`,
    `Website: ${context.website}`,
    `Location: ${context.location}`,
  ];

  if (context.websiteMetadata?.title) parts.push(`Page title: ${context.websiteMetadata.title}`);
  if (context.websiteMetadata?.description) parts.push(`Meta description: ${context.websiteMetadata.description}`);
  if (context.apolloOrganization) {
    parts.push(`Apollo data: industry=${context.apolloOrganization.industry || "unknown"}, employees=${context.apolloOrganization.estimatedNumEmployees || "unknown"}, description=${context.apolloOrganization.shortDescription || "N/A"}`);
  }

  parts.push(
    ``,
    `Return JSON with these fields:`,
    `- companyName: string (display name)`,
    `- category: string (e.g., "SaaS", "E-commerce", "Manufacturing")`,
    `- industry: string (specific industry)`,
    `- description: string (2-3 sentence company description)`,
    `- confidenceScore: number (0-100, based on evidence quality)`,
    `- icp: { industries: string[], personTitles: string[], seniorities: string[], employeeRanges: string[], locations: string[], keywords: string[] }`,
    ``,
    `Rules:`,
    `- Titles must be economic buyers (e.g., "VP Sales", "Head of Growth", "Founder")`,
    `- Employee ranges must use Apollo format: "lower,upper" (e.g., "11,50")`,
    `- Be specific but conservative with confidence scores`,
    `- Return ONLY valid JSON`,
  );

  return parts.join("\n");
}

export function ICP_GENERATION_PROMPT(profile: {
  companyName: string;
  industry: string;
  location: string;
  description: string;
}): string {
  return [
    `Generate an Ideal Customer Profile (ICP) for a B2B company based on the following company profile.`,
    ``,
    `Company: ${profile.companyName}`,
    `Industry: ${profile.industry}`,
    `Location: ${profile.location}`,
    `Description: ${profile.description}`,
    ``,
    `Return JSON with these fields:`,
    `- industries: string[] (target industries, 3-5 items)`,
    `- personTitles: string[] (buyer personas, 5-8 titles that are economic buyers)`,
    `- seniorities: string[] (from: owner, founder, c_suite, vp, head, director, manager)`,
    `- employeeRanges: string[] (Apollo format, 2-3 ranges like "11,50", "51,200")`,
    `- locations: string[] (target geographies)`,
    `- keywords: string[] (search keywords, 5-8 items)`,
    ``,
    `Rules:`,
    `- Titles must be decision-makers, not individual contributors`,
    `- Focus on the most likely buyer personas for this type of company`,
    `- Employee ranges should target the company's natural peer market`,
    `- Return ONLY valid JSON`,
  ].join("\n");
}

export function SALES_PROMPT_TEMPLATE(context: {
  lead: {
    firstName?: string | null;
    company?: string | null;
    title?: string | null;
    industry?: string | null;
  };
  company: {
    name: string;
    description: string;
  };
  channel: "call" | "whatsapp" | "email";
  objective: "introduction" | "follow_up" | "objection_handling" | "meeting_request";
  objection?: string;
  previousContext?: string;
}): string {
  const channelTone: Record<string, string> = {
    call: "conversational and natural, like a phone call",
    whatsapp: "brief and friendly, like a text message",
    email: "professional but approachable, like a business email",
  };

  const objectiveGuidance: Record<string, string> = {
    introduction: "Introduce the company's value proposition and open a dialogue",
    follow_up: "Reference previous interaction and move toward a specific ask",
    objection_handling: `Address the specific objection and reframe the value: "${context.objection || "Unknown objection"}"`,
    meeting_request: "Request a specific meeting time with clear agenda",
  };

  return [
    `Generate a B2B sales ${context.channel} for the following context.`,
    ``,
    `Lead: ${context.lead.firstName || "there"} - ${context.lead.title || "N/A"} at ${context.lead.company || "N/A"}`,
    `Industry: ${context.lead.industry || "unknown"}`,
    `Our company: ${context.company.name} - ${context.company.description}`,
    ``,
    `Channel: ${context.channel} (${channelTone[context.channel]})`,
    `Objective: ${objectiveGuidance[context.objective]}`,
    context.previousContext ? `Previous context: ${context.previousContext}` : "",
    ``,
    `Rules:`,
    `- Keep it under 100 words for calls, 160 characters for WhatsApp, 150 words for emails`,
    `- Be specific to their role and industry, not generic`,
    `- Include a clear next step or call-to-action`,
    `- Reference pain points relevant to their title`,
    `- Return ONLY the message text, no labels or formatting`,
  ].filter(Boolean).join("\n");
}

export function LEAD_SCORING_PROMPT(context: {
  lead: {
    firstName?: string | null;
    company?: string | null;
    title?: string | null;
    industry?: string | null;
    companySize?: string | null;
    city?: string | null;
  };
  icp: IcpProfile;
  previousScore?: number;
  recentActivity?: string;
}): string {
  return [
    `Score this B2B lead 1-100 for sales readiness based on the given ICP.`,
    ``,
    `Lead info:`,
    `- Name: ${context.lead.firstName || "unknown"}`,
    `- Title: ${context.lead.title || "unknown"}`,
    `- Company: ${context.lead.company || "unknown"}`,
    `- Industry: ${context.lead.industry || "unknown"}`,
    `- Company size: ${context.lead.companySize || "unknown"}`,
    `- Location: ${context.lead.city || "unknown"}`,
    ``,
    `ICP target:`,
    `- Industries: ${context.icp.industries.join(", ") || "any"}`,
    `- Titles: ${context.icp.personTitles.join(", ") || "any"}`,
    `- Seniorities: ${context.icp.seniorities.join(", ") || "any"}`,
    `- Employee ranges: ${context.icp.employeeRanges.join(", ") || "any"}`,
    `- Locations: ${context.icp.locations.join(", ") || "any"}`,
    context.previousScore ? `- Previous score: ${context.previousScore}` : "",
    context.recentActivity ? `- Recent activity: ${context.recentActivity}` : "",
    ``,
    `Return JSON with:`,
    `- score: number (1-100)`,
    `- band: "hot" | "warm" | "cold"`,
    `- reasons: string[] (2-4 reasons for the score)`,
    ``,
    `Rules:`,
    `- Hot: 70-100, strong ICP match + intent signals`,
    `- Warm: 40-69, partial match or no strong signals`,
    `- Cold: 1-39, poor match`,
    `- Title match is weighted heavily (VP+ titles are higher)`,
    `- Return ONLY valid JSON`,
  ].filter(Boolean).join("\n");
}

export function DASHBOARD_ASSISTANT_PROMPT(context: {
  companyName: string;
  userRole: string;
  availableData: {
    leadsCount: number;
    meetingsCount: number;
    callsCount: number;
    conversionRate: number;
  };
  recentEvents?: Array<{ type: string; timestamp: string; details: string }>;
}): string {
  const eventSummary = context.recentEvents?.length
    ? `\nRecent activity:\n${context.recentEvents.map((e) => `- ${e.type} at ${e.timestamp}: ${e.details}`).join("\n")}`
    : "";

  return [
    `You are a B2B sales copilot for ${context.companyName}.`,
    `The user is a ${context.userRole} viewing their sales dashboard.`,
    ``,
    `Current metrics:`,
    `- Total leads: ${context.availableData.leadsCount}`,
    `- Scheduled meetings: ${context.availableData.meetingsCount}`,
    `- Total calls: ${context.availableData.callsCount}`,
    `- Conversion rate: ${(context.availableData.conversionRate * 100).toFixed(1)}%`,
    eventSummary,
    ``,
    `Guidelines:`,
    `- Answer questions about the data shown on the dashboard`,
    `- Provide actionable sales insights based on the numbers`,
    `- Suggest specific next steps when asked for recommendations`,
    `- Be concise and direct, avoid unnecessary preamble`,
    `- If asked about data not shown, acknowledge what you can see and what you cannot`,
    `- Never fabricate data or make promises about outcomes`,
  ].join("\n");
}
