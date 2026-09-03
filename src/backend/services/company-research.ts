import { z } from "zod";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface CompanyResearchResult {
  companyName: string;
  website: string;
  description: string;
  category: string;
  industry: string;
  products: string[];
  services: string[];
  targetMarket: string;
  confidenceScore: number;
  sources: string[];
}

const companyResearchResultSchema = z.object({
  companyName: z.string(),
  website: z.string(),
  description: z.string(),
  category: z.string(),
  industry: z.string(),
  products: z.array(z.string()),
  services: z.array(z.string()),
  targetMarket: z.string(),
  confidenceScore: z.number().min(0).max(100),
  sources: z.array(z.string()),
});

function matchMeta(html: string, pattern: RegExp) {
  return html.match(pattern)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 600) || "";
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function researchWebsite(url: string): Promise<{ title: string; description: string; content: string }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "AarambhAI-CompanyResearch/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { title: "", description: "", content: "" };
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return { title: "", description: "", content: "" };
    const html = (await response.text()).slice(0, 200_000);
    return {
      title: matchMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
      description:
        matchMeta(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i) ||
        matchMeta(html, /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i),
      content: stripTags(html).slice(0, 8_000),
    };
  } catch (error) {
    console.warn("[company-research] website fetch failed", error);
    return { title: "", description: "", content: "" };
  }
}

function fallbackCompanyProfile(companyName: string, website: string, websiteData: { title: string; description: string }): CompanyResearchResult {
  return {
    companyName,
    website,
    description: websiteData.description || `${companyName} is a business operating in its industry.`,
    category: "Business services",
    industry: "General",
    products: [],
    services: [],
    targetMarket: "B2B",
    confidenceScore: 40,
    sources: [website],
  };
}

function stripFence(value: string) {
  return value.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}

async function extractWithAi(
  companyName: string,
  website: string,
  websiteData: { title: string; description: string; content: string },
  fallback: CompanyResearchResult,
): Promise<CompanyResearchResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fallback;

  const context = {
    companyName,
    website,
    pageTitle: websiteData.title,
    pageDescription: websiteData.description,
    pageContent: websiteData.content.slice(0, 6_000),
  };

  try {
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Research this company from its website and extract structured business information. Return strict JSON with: companyName (string), website (string), description (1-2 sentence company description), category (e.g. "SaaS", "Manufacturing", "Healthcare"), industry (specific industry), products (array of main products), services (array of main services), targetMarket (who they sell to), confidenceScore (0-100 based on data quality), sources (array of URLs used).\n\n${JSON.stringify(context)}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800, responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return fallback;
    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return fallback;
    const parsed = JSON.parse(stripFence(raw));
    return {
      companyName: typeof parsed.companyName === "string" ? parsed.companyName : companyName,
      website,
      description: typeof parsed.description === "string" ? parsed.description : fallback.description,
      category: typeof parsed.category === "string" ? parsed.category : fallback.category,
      industry: typeof parsed.industry === "string" ? parsed.industry : fallback.industry,
      products: Array.isArray(parsed.products) ? parsed.products.filter((p: unknown): p is string => typeof p === "string").slice(0, 10) : [],
      services: Array.isArray(parsed.services) ? parsed.services.filter((s: unknown): s is string => typeof s === "string").slice(0, 10) : [],
      targetMarket: typeof parsed.targetMarket === "string" ? parsed.targetMarket : fallback.targetMarket,
      confidenceScore: typeof parsed.confidenceScore === "number" ? Math.min(100, Math.max(0, parsed.confidenceScore)) : fallback.confidenceScore,
      sources: [website],
    };
  } catch (error) {
    console.warn("[company-research] AI extraction failed", error);
    return fallback;
  }
}

export async function researchCompany(companyName: string, website: string): Promise<CompanyResearchResult> {
  const normalizedWebsite = /^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`;
  const websiteData = await researchWebsite(normalizedWebsite);
  const fallback = fallbackCompanyProfile(companyName, normalizedWebsite, websiteData);
  return extractWithAi(companyName, normalizedWebsite, websiteData, fallback);
}
