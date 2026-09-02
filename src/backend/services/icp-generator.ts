import { type IcpProfile } from "./apollo";
import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface IcpVersion {
  id: string;
  organizationId: string;
  version: number;
  icp: IcpProfile;
  createdAt: Date;
}

function fallbackIcp(companyProfile: { industry?: string | null; location?: string | null; description?: string | null }): IcpProfile {
  const industry = (companyProfile.industry || "").toLowerCase();
  const location = companyProfile.location || "";

  const personTitles = industry.includes("health")
    ? ["Founder", "Chief Executive Officer", "Growth Head", "Marketing Director", "Operations Director"]
    : industry.includes("software") || industry.includes("technology")
      ? ["Founder", "Chief Executive Officer", "VP Sales", "Head of Growth", "Marketing Director"]
      : ["Owner", "Founder", "Chief Executive Officer", "Head of Sales", "Marketing Director"];

  return {
    industries: companyProfile.industry ? [companyProfile.industry] : [],
    personTitles,
    seniorities: ["owner", "founder", "c_suite", "vp", "head", "director"],
    employeeRanges: ["11,50", "51,200", "201,500"],
    locations: location ? [location] : [],
    keywords: companyProfile.industry
      ? companyProfile.industry.split(/[^a-zA-Z0-9]+/).filter((w) => w.length > 2).slice(0, 5)
      : [],
  };
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 10);
  return result.length > 0 ? result : fallback;
}

export async function generateICP(companyProfile: {
  organizationId: string;
  companyName: string;
  industry?: string | null;
  location?: string | null;
  description?: string | null;
  website?: string | null;
}): Promise<IcpVersion> {
  const fallback = fallbackIcp(companyProfile);
  let icp = fallback;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey) {
    try {
      const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Based on this company profile, generate an Ideal Customer Profile (ICP) for B2B lead generation. Return strict JSON with this exact structure:
{
  "industries": ["target industry names"],
  "personTitles": ["economic buyer job titles"],
  "seniorities": ["owner","founder","c_suite","vp","head","director"],
  "employeeRanges": ["min,max pairs like 11,50"],
  "locations": ["target city/region names"],
  "keywords": ["search keywords 3-5 words each"]
}
Titles must be decision-makers likely to buy. Employee ranges use Apollo format.

Company: ${companyProfile.companyName}
Industry: ${companyProfile.industry || "unknown"}
Location: ${companyProfile.location || "unknown"}
Description: ${companyProfile.description || "N/A"}
Website: ${companyProfile.website || "N/A"}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.2, maxOutputTokens: 800, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(12_000),
      });

      if (response.ok) {
        const data = await response.json();
        const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (raw) {
          const parsed = JSON.parse(raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim());
          icp = {
            industries: stringList(parsed.industries, fallback.industries),
            personTitles: stringList(parsed.personTitles, fallback.personTitles),
            seniorities: stringList(parsed.seniorities, fallback.seniorities),
            employeeRanges: stringList(parsed.employeeRanges, fallback.employeeRanges),
            locations: stringList(parsed.locations, fallback.locations),
            keywords: stringList(parsed.keywords, fallback.keywords),
          };
        }
      }
    } catch (error) {
      console.warn("[icp-generator] AI generation failed, using fallback", error);
    }
  }

  // Determine next version number
  const existing = await db
    .select({ version: schema.businessProfiles.confidenceScore })
    .from(schema.businessProfiles)
    .where(eq(schema.businessProfiles.id, companyProfile.organizationId))
    .limit(1);

  const version = (existing[0]?.version || 0) + 1;

  const id = randomUUID();
  const icpVersion: IcpVersion = {
    id,
    organizationId: companyProfile.organizationId,
    version,
    icp,
    createdAt: new Date(),
  };

  // Store ICP in business_profiles.profile_data
  await db
    .update(schema.businessProfiles)
    .set({
      profileData: { ...((companyProfile as any).profileData || {}), icp, icpVersion: version },
      updatedAt: new Date(),
    })
    .where(eq(schema.businessProfiles.id, companyProfile.organizationId));

  return icpVersion;
}
