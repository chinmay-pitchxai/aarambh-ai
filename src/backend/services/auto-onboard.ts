import { randomUUID } from "crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";
import { researchCompany, type CompanyResearchResult } from "./company-research";
import { generateICP, toIcpProfile, type GeneratedICP } from "./icp-generation";
import { generateLeadsFromICP, type LeadGenerationResult } from "./lead-generation";
import { buildBusinessRAG } from "./rag-builder";
import { generateSalesPrompt } from "./sales-prompt-generator";

export interface AutoOnboardInput {
  tenantId: string;
  companyName: string;
  website: string;
  location?: string;
  leadCount?: number;
}

export interface AutoOnboardResult {
  companyProfile: CompanyResearchResult;
  icp: GeneratedICP;
  leads: LeadGenerationResult;
  sampleLeadDetails: Array<{
    id: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    title: string | null;
    city: string | null;
    industry: string | null;
    score: number;
    band: string;
  }>;
  ragBuilt: boolean;
  promptsGenerated: boolean;
  // Backward-compatible aliases for onboarding service
  sampleLeads: LeadGenerationResult;
  leadSearch: LeadGenerationResult;
}

export async function autoOnboard(
  database: PostgresJsDatabase<typeof schema>,
  input: AutoOnboardInput,
): Promise<AutoOnboardResult> {
  const { tenantId, companyName, website, location, leadCount = 20 } = input;
  const now = new Date();
  const resolvedLocation = location || "India";

  // 1. Research company from website + AI
  const companyProfile = await researchCompany(companyName, website);

  // 2. Upsert business profile
  const existingProfile = await database.query.businessProfiles.findFirst({
    where: eq(schema.businessProfiles.organizationId, tenantId),
  });

  const profileId = existingProfile?.id ?? `bp_${randomUUID().slice(0, 8)}`;
  const profileData = {
    products: companyProfile.products,
    services: companyProfile.services,
    targetMarket: companyProfile.targetMarket,
  };

  if (existingProfile) {
    await database
      .update(schema.businessProfiles)
      .set({
        companyName: companyProfile.companyName,
        website: companyProfile.website,
        industry: companyProfile.industry,
        description: companyProfile.description,
        location: resolvedLocation,
        category: companyProfile.category,
        researchStatus: "completed",
        confidenceScore: companyProfile.confidenceScore,
        lastResearchedAt: now,
        profileData: profileData as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(eq(schema.businessProfiles.id, existingProfile.id));
  } else {
    await database.insert(schema.businessProfiles).values({
      id: profileId,
      organizationId: tenantId,
      companyName: companyProfile.companyName,
      website: companyProfile.website,
      industry: companyProfile.industry,
      description: companyProfile.description,
      location: resolvedLocation,
      category: companyProfile.category,
      researchStatus: "completed",
      confidenceScore: companyProfile.confidenceScore,
      lastResearchedAt: now,
      profileData: profileData as unknown as Record<string, unknown>,
    });
  }

  // 3. Generate ICP
  const icp = await generateICP(database, tenantId, {
    companyName: companyProfile.companyName,
    website: companyProfile.website,
    industry: companyProfile.industry,
    description: companyProfile.description,
    location: resolvedLocation,
    products: companyProfile.products,
    targetMarket: companyProfile.targetMarket,
    category: companyProfile.category,
  });

  // 4. Generate leads from ICP
  const icpProfile = toIcpProfile(icp);
  const leads = await generateLeadsFromICP(database, tenantId, icpProfile, leadCount);

  // 5. Fetch sample leads with details
  const sampleLeads = leads.leadIds.length > 0
    ? await Promise.all(
        leads.leadIds.slice(0, 5).map(async (leadId) => {
          const [cl] = await database
            .select({
              leadId: schema.clientLeads.leadId,
              score: schema.clientLeads.score,
              band: schema.clientLeads.band,
              firstName: schema.leads.firstName,
              lastName: schema.leads.lastName,
              company: schema.leads.company,
              title: schema.leads.title,
              city: schema.leads.city,
              industry: schema.leads.industry,
            })
            .from(schema.clientLeads)
            .innerJoin(schema.leads, eq(schema.clientLeads.leadId, schema.leads.id))
            .where(eq(schema.clientLeads.leadId, leadId))
            .limit(1);
          return cl
            ? { id: cl.leadId, ...cl, score: cl.score ?? 0, band: cl.band ?? "warm" }
            : null;
        }),
      )
    : [];

  // 6. Build RAG from website pages
  let ragBuilt = false;
  try {
    await buildBusinessRAG(database, tenantId, {
      companyName: companyProfile.companyName,
      website: companyProfile.website,
      industry: companyProfile.industry,
      description: companyProfile.description,
    });
    ragBuilt = true;
  } catch (err) {
    console.warn("[auto-onboard] RAG build failed:", err);
  }

  // 7. Generate sales prompts
  let promptsGenerated = false;
  try {
    await generateSalesPrompt(database, tenantId, {
      companyName: companyProfile.companyName,
      website: companyProfile.website,
      industry: companyProfile.industry,
      description: companyProfile.description,
      location: resolvedLocation,
      products: companyProfile.products,
      targetMarket: companyProfile.targetMarket,
    }, icp);
    promptsGenerated = true;
  } catch (err) {
    console.warn("[auto-onboard] Prompt generation failed:", err);
  }

  return {
    companyProfile,
    icp,
    leads,
    sampleLeadDetails: sampleLeads.filter(Boolean) as AutoOnboardResult["sampleLeadDetails"],
    ragBuilt,
    promptsGenerated,
    sampleLeads: leads,
    leadSearch: leads,
  };
}
