import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface CompanyProfileInput {
  companyName: string;
  website: string;
  industry: string;
  description: string;
  location: string;
  products?: string[];
  targetMarket?: string;
  category?: string;
}

export interface GeneratedICP {
  target_industries: string[];
  target_titles: string[];
  target_seniorities: string[];
  target_company_sizes: string[];
  target_locations: string[];
  keywords: string[];
  scoring_weights: {
    industry: number;
    title: number;
    company_size: number;
    location: number;
    seniority: number;
  };
}

export interface IcpProfile {
  industries: string[];
  personTitles: string[];
  seniorities: string[];
  employeeRanges: string[];
  locations: string[];
  keywords: string[];
}

function fallbackICP(profile: CompanyProfileInput): GeneratedICP {
  const normalized = profile.industry.toLowerCase();
  const titles = normalized.includes("health")
    ? ["Founder", "Chief Executive Officer", "Growth Head", "Marketing Director", "Operations Director"]
    : normalized.includes("software") || normalized.includes("technology")
      ? ["Founder", "Chief Executive Officer", "VP Sales", "Head of Growth", "Marketing Director"]
      : ["Owner", "Founder", "Chief Executive Officer", "Head of Sales", "Marketing Director"];

  return {
    target_industries: [profile.industry],
    target_titles: titles,
    target_seniorities: ["owner", "founder", "c_suite", "vp", "head", "director"],
    target_company_sizes: ["11-50", "51-200", "201-500"],
    target_locations: [profile.location],
    keywords: profile.industry.split(/[^a-zA-Z0-9]+/).filter((w) => w.length > 2).slice(0, 5),
    scoring_weights: {
      industry: 0.3,
      title: 0.25,
      company_size: 0.2,
      location: 0.15,
      seniority: 0.1,
    },
  };
}

function stripFence(value: string): string {
  return value.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

function coerceStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 15);
  return result.length > 0 ? result : fallback;
}

function coerceWeights(value: unknown): GeneratedICP["scoring_weights"] {
  if (!value || typeof value !== "object") {
    return { industry: 0.3, title: 0.25, company_size: 0.2, location: 0.15, seniority: 0.1 };
  }
  const obj = value as Record<string, unknown>;
  const total = (Number(obj.industry) || 0) + (Number(obj.title) || 0) + (Number(obj.company_size) || 0) + (Number(obj.location) || 0) + (Number(obj.seniority) || 0);
  if (total === 0) return { industry: 0.3, title: 0.25, company_size: 0.2, location: 0.15, seniority: 0.1 };
  return {
    industry: Number(obj.industry) || 0,
    title: Number(obj.title) || 0,
    company_size: Number(obj.company_size) || 0,
    location: Number(obj.location) || 0,
    seniority: Number(obj.seniority) || 0,
  };
}

export function toIcpProfile(icp: GeneratedICP): IcpProfile {
  return {
    industries: icp.target_industries,
    personTitles: icp.target_titles,
    seniorities: icp.target_seniorities,
    employeeRanges: icp.target_company_sizes.map((s) => s.replace("-", ",")),
    locations: icp.target_locations,
    keywords: icp.keywords,
  };
}

async function storeICP(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  icp: GeneratedICP,
): Promise<void> {
  const existing = await db.query.businessProfiles.findFirst({
    where: eq(schema.businessProfiles.organizationId, tenantId),
  });

  const icpProfile = toIcpProfile(icp);

  if (existing) {
    const currentVersion = (existing.icpVersion ?? 0) + 1;
    await db
      .update(schema.businessProfiles)
      .set({
        icp: icpProfile as unknown as Record<string, unknown>,
        icpVersion: currentVersion,
        updatedAt: new Date(),
      })
      .where(eq(schema.businessProfiles.id, existing.id));
  } else {
    await db.insert(schema.businessProfiles).values({
      id: `bp_${crypto.randomUUID()}`,
      organizationId: tenantId,
      icp: icpProfile as unknown as Record<string, unknown>,
      icpVersion: 1,
    });
  }
}

export async function generateICP(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  companyProfile: CompanyProfileInput,
): Promise<GeneratedICP> {
  const fallback = fallbackICP(companyProfile);
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    await storeICP(db, tenantId, fallback);
    return fallback;
  }

  const context = {
    companyName: companyProfile.companyName,
    website: companyProfile.website,
    industry: companyProfile.industry,
    description: companyProfile.description,
    location: companyProfile.location,
    products: companyProfile.products,
    targetMarket: companyProfile.targetMarket,
    category: companyProfile.category,
  };

  try {
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are a B2B Ideal Customer Profile (ICP) analyst. Given the company profile below, generate a precise ICP that identifies who this company should target for sales outreach.

Company Profile:
${JSON.stringify(context)}

Return STRICT JSON with this exact schema:
{
  "target_industries": ["list of industries to target, e.g. SaaS, FinTech, Healthcare"],
  "target_titles": ["specific job titles of economic buyers, e.g. VP of Sales, CTO, Head of Operations"],
  "target_seniorities": ["owner", "founder", "c_suite", "vp", "head", "director", "manager"],
  "target_company_sizes": ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000"],
  "target_locations": ["cities, states, or countries to target"],
  "keywords": ["5-10 industry keywords for lead filtering"],
  "scoring_weights": {
    "industry": 0.3,
    "title": 0.25,
    "company_size": 0.2,
    "location": 0.15,
    "seniority": 0.1
  }
}

Rules:
- target_titles must be real job titles that make buying decisions
- target_company_sizes must use the format "lower-upper"
- scoring_weights must sum to approximately 1.0
- Be specific to THIS company, not generic
- Return 3-8 items per list, 5-10 keywords` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      await storeICP(db, tenantId, fallback);
      return fallback;
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      await storeICP(db, tenantId, fallback);
      return fallback;
    }

    const parsed = JSON.parse(stripFence(raw));
    const icp: GeneratedICP = {
      target_industries: coerceStringArray(parsed.target_industries, fallback.target_industries),
      target_titles: coerceStringArray(parsed.target_titles, fallback.target_titles),
      target_seniorities: coerceStringArray(parsed.target_seniorities, fallback.target_seniorities),
      target_company_sizes: coerceStringArray(parsed.target_company_sizes, fallback.target_company_sizes),
      target_locations: coerceStringArray(parsed.target_locations, fallback.target_locations),
      keywords: coerceStringArray(parsed.keywords, fallback.keywords),
      scoring_weights: coerceWeights(parsed.scoring_weights),
    };

    await storeICP(db, tenantId, icp);
    return icp;
  } catch (error) {
    console.warn("[icp-generation] AI generation failed, using fallback", error);
    await storeICP(db, tenantId, fallback);
    return fallback;
  }
}
