import { randomUUID } from "crypto";
import { type IcpProfile, searchApolloProspects, type ApolloProspect } from "./apollo";
import { db, schema } from "../db";
import { eq, and, sql } from "drizzle-orm";

// ── Lead Generation Pipeline ──
// ICP → Apollo search → normalize → dedupe → score → store

export interface LeadGenerationResult {
  totalSearched: number;
  totalFound: number;
  totalNew: number;
  totalDuplicate: number;
  leadIds: string[];
}

export interface ScoredLead {
  leadId: string;
  score: number;
  band: "hot" | "warm" | "cold";
}

// ── Convert Apollo prospect to our lead schema ──

export function normalizeApolloLead(raw: ApolloProspect) {
  const phone = normalizePhone(raw.phone);
  return {
    phoneE164: phone,
    email: raw.email || null,
    firstName: raw.firstName || null,
    lastName: raw.lastName || null,
    company: raw.company || null,
    title: raw.title || null,
    city: raw.city || null,
    industry: raw.industry || null,
    companySize: raw.companySize || null,
    sourceRef: raw.id || null,
    sourceCost: 100, // Apollo cost per lead in paise
    rawData: raw.raw,
  };
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length >= 10) {
    if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
    if (digits.length === 10) return `+91${digits}`;
    if (digits.startsWith("+")) return `+${digits.replace(/\+/g, "")}`;
  }
  return `+${digits}`;
}

// ── ICP-based lead scoring ──

export function scoreLead(lead: ReturnType<typeof normalizeApolloLead>, icp: IcpProfile): ScoredLead {
  let score = 50;

  // Industry match (0-20)
  const industry = (lead.industry || "").toLowerCase();
  const icpIndustries = icp.industries.map((i) => i.toLowerCase());
  if (icpIndustries.some((i) => industry.includes(i) || i.includes(industry))) score += 20;
  else if (industry && icpIndustries.length > 0) score += 5;

  // Title match (0-25)
  const title = (lead.title || "").toLowerCase();
  const matchedTitle = icp.personTitles.some((t) => title.includes(t.toLowerCase()));
  if (matchedTitle) score += 25;
  else if (/\b(vp|director|head|chief|cto|ceo|cfo|owner|founder)\b/.test(title)) score += 15;
  else if (/\b(manager|lead|senior)\b/.test(title)) score += 8;

  // Company size match (0-15)
  const size = parseInt(lead.companySize || "0", 10);
  const sizeMatch = icp.employeeRanges.some((range) => {
    const [min, max] = range.split(",").map(Number);
    return size >= min && size <= (max || 100000);
  });
  if (sizeMatch) score += 15;
  else if (size > 50) score += 5;

  // Location match (0-10)
  const city = (lead.city || "").toLowerCase();
  const matchedLocation = icp.locations.some((loc) => city.includes(loc.toLowerCase()));
  if (matchedLocation) score += 10;

  // Email availability bonus
  if (lead.email) score += 5;

  score = Math.max(1, Math.min(100, score));
  const band = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
  return { leadId: "", score, band };
}

// ── Generate leads from ICP ──

export async function generateLeadsFromICP(
  db: typeof import("../db").db,
  tenantId: string,
  icp: IcpProfile,
  batchSize = 20,
): Promise<LeadGenerationResult> {
  const prospects = await searchApolloProspects(icp, batchSize);
  const totalSearched = batchSize;
  const leadIds: string[] = [];
  let totalNew = 0;
  let totalDuplicate = 0;

  for (const prospect of prospects) {
    const normalized = normalizeApolloLead(prospect);
    const { score, band } = scoreLead(normalized, icp);
    const phone = normalized.phoneE164;

    // Dedupe by phone or email
    const existingLead = phone
      ? await db.select().from(schema.leads).where(eq(schema.leads.phoneE164, phone)).limit(1)
      : [];

    if (existingLead.length > 0) {
      totalDuplicate++;
      continue;
    }

    // Check email dedup if no phone match
    if (normalized.email) {
      const emailMatch = await db.select().from(schema.leads).where(eq(schema.leads.email, normalized.email)).limit(1);
      if (emailMatch.length > 0) {
        totalDuplicate++;
        continue;
      }
    }

    // Insert into mother leads
    const leadId = randomUUID();
    await db.insert(schema.leads).values({
      id: leadId,
      phoneE164: phone,
      email: normalized.email,
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      company: normalized.company,
      title: normalized.title,
      city: normalized.city,
      industry: normalized.industry,
      companySize: normalized.companySize,
      sourceRef: normalized.sourceRef,
      sourceCost: normalized.sourceCost,
      rawData: normalized.rawData,
      icpTags: JSON.stringify(icp.personTitles.slice(0, 3)),
      freshness: new Date(),
    });

    // Insert into client_leads
    await db.insert(schema.clientLeads).values({
      id: randomUUID(),
      clientId: tenantId,
      leadId,
      score,
      band,
      reusedFrom: null,
    });

    leadIds.push(leadId);
    totalNew++;
  }

  return { totalSearched, totalFound: prospects.length, totalNew, totalDuplicate, leadIds };
}

// ── Generate exactly N sample leads for confirmation ──

export async function generateSampleLeads(
  db: typeof import("../db").db,
  tenantId: string,
  icp: IcpProfile,
  count = 3,
): Promise<LeadGenerationResult> {
  const prospects = await searchApolloProspects(icp, count);
  const limited = prospects.slice(0, count);
  const leadIds: string[] = [];
  let totalNew = 0;
  let totalDuplicate = 0;

  for (const prospect of limited) {
    const normalized = normalizeApolloLead(prospect);
    const { score, band } = scoreLead(normalized, icp);
    const phone = normalized.phoneE164;

    // Dedupe
    const existingLead = phone
      ? await db.select().from(schema.leads).where(eq(schema.leads.phoneE164, phone)).limit(1)
      : [];

    if (existingLead.length > 0) {
      totalDuplicate++;
      continue;
    }

    if (normalized.email) {
      const emailMatch = await db.select().from(schema.leads).where(eq(schema.leads.email, normalized.email)).limit(1);
      if (emailMatch.length > 0) {
        totalDuplicate++;
        continue;
      }
    }

    const leadId = randomUUID();
    await db.insert(schema.leads).values({
      id: leadId,
      phoneE164: phone,
      email: normalized.email,
      firstName: normalized.firstName,
      lastName: normalized.lastName,
      company: normalized.company,
      title: normalized.title,
      city: normalized.city,
      industry: normalized.industry,
      companySize: normalized.companySize,
      sourceRef: normalized.sourceRef,
      sourceCost: normalized.sourceCost,
      rawData: normalized.rawData,
      icpTags: JSON.stringify(icp.personTitles.slice(0, 3)),
      freshness: new Date(),
    });

    await db.insert(schema.clientLeads).values({
      id: randomUUID(),
      clientId: tenantId,
      leadId,
      score,
      band,
      reusedFrom: null,
    });

    leadIds.push(leadId);
    totalNew++;
  }

  return { totalSearched: count, totalFound: limited.length, totalNew, totalDuplicate, leadIds };
}
