import { eq, desc } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import type { GeneratedICP } from "./icp-generation";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface CompanyProfileForPrompts {
  companyName: string;
  website: string;
  industry: string;
  description: string;
  location: string;
  products?: string[];
  targetMarket?: string;
  valueProposition?: string;
  painPoints?: string[];
  competitors?: string[];
}

export interface SalesPromptTemplate {
  id: string;
  tenantId: string;
  companyId: string;
  promptType: string;
  promptVersion: number;
  systemPrompt: string;
  behaviorPrompt: string;
  qualificationPrompt: string;
  objectionPrompt: string;
  closingPrompt: string;
  status: string;
  createdAt: Date;
}

interface GeneratedPrompts {
  system_prompt: string;
  behavior_prompt: string;
  qualification_prompt: string;
  objection_prompt: string;
  closing_prompt: string;
}

function fallbackPrompts(profile: CompanyProfileForPrompts, icp: GeneratedICP): GeneratedPrompts {
  const industries = icp.target_industries.join(", ");
  const titles = icp.target_titles.slice(0, 5).join(", ");

  return {
    system_prompt: `You are an AI sales development representative for ${profile.companyName}, a company in the ${profile.industry} industry based in ${profile.location}. ${profile.description} You are reaching out to potential customers in ${industries} targeting roles like ${titles}. Your goal is to book qualified meetings. Be professional, concise, and focus on value rather than features.`,

    behavior_prompt: `Sales Behavior Guidelines for ${profile.companyName}:
- Always personalize opening based on the lead's role and company
- Reference specific pain points relevant to their industry
- Keep messages under 50 words for first touch
- Use a consultative selling approach
- Never use hard-sell tactics or aggressive language
- Ask one open-ended question per message
- Follow up maximum 3 times before pausing
- Always provide value in every interaction (insight, resource, or relevant case study)
- Adapt tone to the lead's seniority level`,

    qualification_prompt: `Lead Qualification Framework (BANT) for ${profile.companyName}:
1. Budget: Ask about current spending on ${profile.industry} solutions and budget allocation timeline
2. Authority: Identify if the contact is the decision-maker or influencer; ask who else is involved in the evaluation
3. Need: Understand their biggest challenge in ${profile.industry}; ask what a successful outcome looks like for them
4. Timeline: Determine if there is an active initiative or when they plan to address this need
Qualification questions:
- "What does your current ${profile.industry} setup look like?"
- "Who else would be involved in evaluating a solution like ours?"
- "What's the biggest challenge you're facing right now with [relevant area]?"
- "When are you looking to have a solution in place?"
Score leads 1-4 on each BANT dimension. Only pursue leads scoring 12+ overall.`,

    objection_prompt: `Common Objections and Responses for ${profile.companyName}:
1. "We're already using [competitor]" → "That's great you have a solution in place. Many of our customers switched because [specific differentiator]. Would you be open to a 15-minute comparison?"
2. "We don't have budget right now" → "Understood. Many clients start by understanding the ROI potential. Can I share a quick case study of how [similar company] saved [metric]?"
3. "Not the right time" → "I respect your timing. What would need to change for this to become a priority? I can check back at a better time."
4. "Need to talk to my team" → "Absolutely. Would it help if I prepared a one-pager you can share with your team?"
5. "Your product is too expensive" → "Price is important. Let me understand what you're comparing against — we often find the total cost of ownership favors our approach."
Always acknowledge the objection, then redirect to value.`,

    closing_prompt: `Meeting Booking Protocol for ${profile.companyName}:
- After 2-3 meaningful exchanges, propose a specific meeting
- Offer two specific time slots (not "sometime next week")
- Frame the meeting around THEIR problem, not your product
- Confirm the meeting agenda in the booking message
- Send a reminder 24 hours before
- If they decline, ask permission to follow up in 30 days
Meeting pitch template: "I'd love to show you how [specific benefit] could help [their company] with [their pain point]. Do you have 20 minutes this [day] or [day]?"
Always end with a clear call-to-action.`,
  };
}

function stripFence(value: string): string {
  return value.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

export async function generateSalesPrompt(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  companyProfile: CompanyProfileForPrompts,
  icp: GeneratedICP,
): Promise<SalesPromptTemplate> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const fallback = fallbackPrompts(companyProfile, icp);

  let prompts: GeneratedPrompts;

  if (!apiKey) {
    prompts = fallback;
  } else {
    const context = {
      company: {
        name: companyProfile.companyName,
        industry: companyProfile.industry,
        description: companyProfile.description,
        location: companyProfile.location,
        website: companyProfile.website,
        products: companyProfile.products,
        targetMarket: companyProfile.targetMarket,
        valueProposition: companyProfile.valueProposition,
        painPoints: companyProfile.painPoints,
        competitors: companyProfile.competitors,
      },
      icp: {
        industries: icp.target_industries,
        titles: icp.target_titles,
        seniorities: icp.target_seniorities,
        companySizes: icp.target_company_sizes,
        locations: icp.target_locations,
        keywords: icp.keywords,
      },
    };

    try {
      const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `You are an expert B2B sales strategist. Generate a complete, customized sales outreach prompt system for this company. The prompts must be specific to their industry, product, and target audience — NOT generic.

Company & ICP Context:
${JSON.stringify(context)}

Return STRICT JSON with this exact schema:
{
  "system_prompt": "A detailed system prompt (200-400 words) that defines the AI sales rep's identity, role, and core mandate. Include company-specific context, industry expertise framing, and the primary objective of outreach.",
  "behavior_prompt": "Detailed behavioral guidelines (200-300 words) covering tone, messaging rules, personalization approach, follow-up strategy, and channel-specific etiquette (WhatsApp, email, phone). Must reference the company's specific value propositions.",
  "qualification_prompt": "A customized BANT qualification framework (200-300 words) with industry-specific discovery questions. Include scoring criteria relevant to THIS company's sales cycle and buyer persona.",
  "objection_prompt": "The 5 most likely objections for THIS company's product/industry, each with a specific, non-generic response strategy. Include competitor-specific objection handling based on the company's competitive landscape.",
  "closing_prompt": "A meeting booking protocol (150-250 words) customized to the company's typical deal size, sales cycle length, and buyer persona. Include specific CTAs and scheduling language."
}

Rules:
- Every prompt must reference the company name and specific industry context
- Never use placeholder text like [Company Name] or [Industry]
- Be specific about the company's likely value propositions based on their description
- Qualification questions must be tailored to their industry's buying process
- Objections must reflect real challenges in their specific market
- Closing strategy must match the typical sales cycle of their industry` }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 2500, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(20_000),
      });

      if (!response.ok) {
        prompts = fallback;
      } else {
        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!raw) {
          prompts = fallback;
        } else {
          const parsed = JSON.parse(stripFence(raw));
          prompts = {
            system_prompt: typeof parsed.system_prompt === "string" && parsed.system_prompt.length > 50 ? parsed.system_prompt : fallback.system_prompt,
            behavior_prompt: typeof parsed.behavior_prompt === "string" && parsed.behavior_prompt.length > 50 ? parsed.behavior_prompt : fallback.behavior_prompt,
            qualification_prompt: typeof parsed.qualification_prompt === "string" && parsed.qualification_prompt.length > 50 ? parsed.qualification_prompt : fallback.qualification_prompt,
            objection_prompt: typeof parsed.objection_prompt === "string" && parsed.objection_prompt.length > 50 ? parsed.objection_prompt : fallback.objection_prompt,
            closing_prompt: typeof parsed.closing_prompt === "string" && parsed.closing_prompt.length > 50 ? parsed.closing_prompt : fallback.closing_prompt,
          };
        }
      }
    } catch (error) {
      console.warn("[sales-prompt-generator] AI generation failed, using fallback", error);
      prompts = fallback;
    }
  }

  return storePromptTemplate(db, tenantId, companyProfile, prompts);
}

async function storePromptTemplate(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  companyProfile: CompanyProfileForPrompts,
  prompts: GeneratedPrompts,
): Promise<SalesPromptTemplate> {
  const existing = await db.query.businessProfiles.findFirst({
    where: eq(schema.businessProfiles.organizationId, tenantId),
  });

  const companyId = existing?.id ?? `bp_${crypto.randomUUID()}`;

  if (!existing) {
    await db.insert(schema.businessProfiles).values({
      id: companyId,
      organizationId: tenantId,
      companyName: companyProfile.companyName,
      website: companyProfile.website,
      industry: companyProfile.industry,
      description: companyProfile.description,
      location: companyProfile.location,
    });
  }

  const latestVersion = await db.query.promptTemplates.findFirst({
    where: eq(schema.promptTemplates.companyId, companyId),
    orderBy: desc(schema.promptTemplates.promptVersion),
  });

  const nextVersion = (latestVersion?.promptVersion ?? 0) + 1;

  const templateId = `pt_${crypto.randomUUID()}`;
  const now = new Date();

  await db.insert(schema.promptTemplates).values({
    id: templateId,
    tenantId,
    companyId,
    promptType: "master",
    promptVersion: nextVersion,
    systemPrompt: prompts.system_prompt,
    behaviorPrompt: prompts.behavior_prompt,
    qualificationPrompt: prompts.qualification_prompt,
    objectionPrompt: prompts.objection_prompt,
    closingPrompt: prompts.closing_prompt,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return {
    id: templateId,
    tenantId,
    companyId,
    promptType: "master",
    promptVersion: nextVersion,
    systemPrompt: prompts.system_prompt,
    behaviorPrompt: prompts.behavior_prompt,
    qualificationPrompt: prompts.qualification_prompt,
    objectionPrompt: prompts.objection_prompt,
    closingPrompt: prompts.closing_prompt,
    status: "active",
    createdAt: now,
  };
}

export async function getActivePromptTemplate(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
): Promise<SalesPromptTemplate | null> {
  const profile = await db.query.businessProfiles.findFirst({
    where: eq(schema.businessProfiles.organizationId, tenantId),
  });
  if (!profile) return null;

  const template = await db.query.promptTemplates.findFirst({
    where: eq(schema.promptTemplates.companyId, profile.id),
    orderBy: desc(schema.promptTemplates.promptVersion),
  });

  if (!template) return null;

  return {
    id: template.id,
    tenantId: template.tenantId,
    companyId: template.companyId,
    promptType: template.promptType ?? "master",
    promptVersion: template.promptVersion ?? 1,
    systemPrompt: template.systemPrompt ?? "",
    behaviorPrompt: template.behaviorPrompt ?? "",
    qualificationPrompt: template.qualificationPrompt ?? "",
    objectionPrompt: template.objectionPrompt ?? "",
    closingPrompt: template.closingPrompt ?? "",
    status: template.status ?? "draft",
    createdAt: template.createdAt ?? new Date(),
  };
}
