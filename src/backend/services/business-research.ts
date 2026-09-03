import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { enrichApolloOrganization, type ApolloOrganization, type IcpProfile } from "./apollo";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface BusinessResearchResult {
  companyName: string;
  website: string;
  location: string;
  category: string;
  industry: string;
  description: string;
  confidenceScore: number;
  sources: string[];
  icp: IcpProfile;
  organization: ApolloOrganization | null;
  websiteMetadata: Record<string, string>;
}

function isPrivateIp(address: string) {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
}

export function normalizeWebsite(value: string) {
  const withProtocol = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  const url = new URL(withProtocol);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Website must use http or https");
  return url.toString();
}

async function assertPublicWebsite(url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) throw new Error("Local network websites are not supported");
  if (isIP(hostname) && isPrivateIp(hostname)) throw new Error("Private network websites are not supported");
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((item) => isPrivateIp(item.address))) throw new Error("Website must resolve to a public address");
}

function matchMeta(html: string, pattern: RegExp) {
  return html.match(pattern)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 600) || "";
}

async function readWebsiteMetadata(website: string): Promise<Record<string, string>> {
  try {
    const url = new URL(website);
    await assertPublicWebsite(url);
    const response = await fetch(url, {
      headers: { "User-Agent": "AarambhAI-BusinessResearch/1.0" },
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return {};
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return {};
    const html = (await response.text()).slice(0, 250_000);
    return {
      title: matchMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      description: matchMeta(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i) || matchMeta(html, /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i),
    };
  } catch (error) {
    console.warn("[business-research] website metadata unavailable", error);
    return {};
  }
}

function cleanLocation(value = "") {
  try {
    const url = new URL(value);
    if (url.hostname.includes("google.")) return url.searchParams.get("query") || url.searchParams.get("q") || value;
  } catch {
    // A normal city/region value is already usable.
  }
  return value.trim();
}

function fallbackIcp(industry: string, location: string): IcpProfile {
  const normalized = industry.toLowerCase();
  const personTitles = normalized.includes("health")
    ? ["Founder", "Chief Executive Officer", "Growth Head", "Marketing Director", "Operations Director"]
    : normalized.includes("software") || normalized.includes("technology")
      ? ["Founder", "Chief Executive Officer", "VP Sales", "Head of Growth", "Marketing Director"]
      : ["Owner", "Founder", "Chief Executive Officer", "Head of Sales", "Marketing Director"];
  return {
    industries: industry ? [industry] : [],
    personTitles,
    seniorities: ["owner", "founder", "c_suite", "vp", "head", "director"],
    employeeRanges: ["11,50", "51,200", "201,500"],
    locations: location ? [location] : [],
    keywords: industry ? industry.split(/[^a-zA-Z0-9]+/).filter((word) => word.length > 2).slice(0, 5) : [],
  };
}

function stringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const result = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 10);
  return result.length > 0 ? result : fallback;
}

async function generateResearchWithAi(context: Record<string, unknown>, fallback: Omit<BusinessResearchResult, "organization" | "websiteMetadata" | "sources">) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fallback;
  try {
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Research this business using only the supplied website and Apollo facts, then define its ideal B2B customer profile. Return strict JSON with category, industry, description, and icp {industries, personTitles, seniorities, employeeRanges, locations, keywords}. Titles must be likely economic buyers. Employee ranges must use Apollo's \"lower,upper\" format.\n\n${JSON.stringify(context)}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return fallback;
    const parsed = JSON.parse(raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim());
    return {
      ...fallback,
      category: typeof parsed.category === "string" ? parsed.category : fallback.category,
      industry: typeof parsed.industry === "string" ? parsed.industry : fallback.industry,
      description: typeof parsed.description === "string" ? parsed.description : fallback.description,
      confidenceScore: 90,
      icp: {
        industries: stringList(parsed.icp?.industries, fallback.icp.industries),
        personTitles: stringList(parsed.icp?.personTitles, fallback.icp.personTitles),
        seniorities: stringList(parsed.icp?.seniorities, fallback.icp.seniorities),
        employeeRanges: stringList(parsed.icp?.employeeRanges, fallback.icp.employeeRanges),
        locations: stringList(parsed.icp?.locations, fallback.icp.locations),
        keywords: stringList(parsed.icp?.keywords, fallback.icp.keywords),
      },
    };
  } catch (error) {
    console.warn("[business-research] AI profile generation failed", error);
    return fallback;
  }
}

export async function researchBusiness(input: { companyName: string; businessType?: string; website?: string; mapLocation?: string }): Promise<BusinessResearchResult> {
  const website = input.website?.trim() ? normalizeWebsite(input.website) : "";
  const location = cleanLocation(input.mapLocation);
  const [websiteMetadata, organizationResult] = await Promise.all([
    website ? readWebsiteMetadata(website) : Promise.resolve<Record<string, string>>({}),
    website ? enrichApolloOrganization({ companyName: input.companyName, website }).catch((error) => {
      console.warn("[business-research] Apollo organization enrichment unavailable", error);
      return null;
    }) : Promise.resolve(null),
  ]);
  const organization = organizationResult;
  const businessType = input.businessType?.trim() || "Business services";
  const industry = organization?.industry || businessType;
  const fallback = {
    companyName: input.companyName.trim(),
    website,
    location,
    category: industry,
    industry,
    description: organization?.shortDescription || websiteMetadata.description || `${input.companyName.trim()} serves customers in ${industry}.`,
    confidenceScore: organization || websiteMetadata.description ? 75 : 55,
    icp: fallbackIcp(industry, location),
  };
  const researched = await generateResearchWithAi({ companyName: input.companyName, businessType, website, location, websiteMetadata, apolloOrganization: organization }, fallback);
  return {
    ...researched,
    organization,
    websiteMetadata,
    sources: [...(website ? [website] : []), ...(organization ? ["Apollo organization enrichment"] : [])],
  };
}
