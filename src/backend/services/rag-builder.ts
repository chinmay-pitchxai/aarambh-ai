import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

export interface RAGChunk {
  id: string;
  url: string;
  title: string;
  content: string;
  category: "about" | "products" | "pricing" | "faq" | "general";
}

export interface RAGData {
  chunks: RAGChunk[];
  builtAt: string;
  sourceUrls: string[];
  totalChunks: number;
}

export interface CompanyProfileForRAG {
  companyName: string;
  website: string;
  industry: string;
  description: string;
}

const PAGE_PATTERNS: Array<{ path: string; category: RAGChunk["category"] }> = [
  { path: "/", category: "about" },
  { path: "/about", category: "about" },
  { path: "/about-us", category: "about" },
  { path: "/company", category: "about" },
  { path: "/products", category: "products" },
  { path: "/product", category: "products" },
  { path: "/services", category: "products" },
  { path: "/service", category: "products" },
  { path: "/solutions", category: "products" },
  { path: "/pricing", category: "pricing" },
  { path: "/plans", category: "pricing" },
  { path: "/faq", category: "faq" },
  { path: "/help", category: "faq" },
  { path: "/support", category: "faq" },
];

function chunkText(text: string, maxChunkSize = 1500): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxChunkSize) return [cleaned];

  const chunks: string[] = [];
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += `${sentence} `;
  }

  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

function extractTextFromHtml(html: string): string {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/\s+/g, " ");
  return text.trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function isPrivateIp(address: string): boolean {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || parts[0] === 0;
}

async function fetchPage(url: string): Promise<{ html: string; ok: boolean }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "AarambhAI-RAGBuilder/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { html: "", ok: false };
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return { html: "", ok: false };
    const html = (await response.text()).slice(250_000);
    return { html, ok: true };
  } catch {
    return { html: "", ok: false };
  }
}

function simpleScore(query: string, text: string): number {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const textLower = text.toLowerCase();
  let score = 0;
  for (const word of queryWords) {
    const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const matches = textLower.match(regex);
    if (matches) score += matches.length;
  }
  return score;
}

export async function buildBusinessRAG(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  companyProfile: CompanyProfileForRAG,
): Promise<RAGData> {
  let websiteUrl: URL;
  try {
    const normalized = /^https?:\/\//i.test(companyProfile.website.trim())
      ? companyProfile.website.trim()
      : `https://${companyProfile.website.trim()}`;
    websiteUrl = new URL(normalized);
  } catch {
    return { chunks: [], builtAt: new Date().toISOString(), sourceUrls: [], totalChunks: 0 };
  }

  const hostname = websiteUrl.hostname;
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    return { chunks: [], builtAt: new Date().toISOString(), sourceUrls: [], totalChunks: 0 };
  }

  const baseUrl = `${websiteUrl.protocol}//${hostname}`;
  const allChunks: RAGChunk[] = [];
  const sourceUrls: string[] = [];
  const seenPaths = new Set<string>();

  for (const { path, category } of PAGE_PATTERNS) {
    const url = `${baseUrl}${path}`;
    if (seenPaths.has(url)) continue;
    seenPaths.add(url);

    const { html, ok } = await fetchPage(url);
    if (!ok || html.length < 100) continue;

    const text = extractTextFromHtml(html);
    if (text.length < 50) continue;

    const title = extractTitle(html) || `${category} - ${companyProfile.companyName}`;
    const contentChunks = chunkText(text);

    for (let i = 0; i < contentChunks.length; i++) {
      allChunks.push({
        id: `chunk_${hostname.replace(/\./g, "_")}_${path.replace(/\//g, "_")}_${i}`,
        url,
        title,
        content: contentChunks[i],
        category,
      });
    }
    sourceUrls.push(url);
  }

  if (allChunks.length === 0) {
    const descriptionChunk: RAGChunk = {
      id: `chunk_${hostname.replace(/\./g, "_")}_description`,
      url: baseUrl,
      title: companyProfile.companyName,
      content: `${companyProfile.companyName} — ${companyProfile.description}. Industry: ${companyProfile.industry}.`,
      category: "about",
    };
    allChunks.push(descriptionChunk);
    sourceUrls.push(baseUrl);
  }

  const ragData: RAGData = {
    chunks: allChunks,
    builtAt: new Date().toISOString(),
    sourceUrls,
    totalChunks: allChunks.length,
  };

  const existing = await db.query.businessProfiles.findFirst({
    where: eq(schema.businessProfiles.organizationId, tenantId),
  });

  if (existing) {
    await db
      .update(schema.businessProfiles)
      .set({
        ragData: ragData as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.businessProfiles.id, existing.id));
  } else {
    await db.insert(schema.businessProfiles).values({
      id: `bp_${crypto.randomUUID()}`,
      organizationId: tenantId,
      companyName: companyProfile.companyName,
      website: companyProfile.website,
      industry: companyProfile.industry,
      description: companyProfile.description,
      ragData: ragData as unknown as Record<string, unknown>,
    });
  }

  return ragData;
}

export function searchRAG(ragData: RAGData, query: string, topK = 5): RAGChunk[] {
  const scored = ragData.chunks.map((chunk) => ({
    chunk,
    score: simpleScore(query, chunk.content) + simpleScore(query, chunk.title) * 2,
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .filter((item) => item.score > 0)
    .slice(0, topK)
    .map((item) => item.chunk);
}

export function getRAGContext(ragData: RAGData, query: string, topK = 3): string {
  const relevant = searchRAG(ragData, query, topK);
  if (relevant.length === 0) return "";

  return relevant
    .map((chunk) => `[Source: ${chunk.url} | ${chunk.title}]\n${chunk.content}`)
    .join("\n\n---\n\n");
}
