import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { buildBusinessRAG, type CompanyProfileForRAG } from "./rag-builder";
import { generateSalesPrompt, type CompanyProfileForPrompts } from "./sales-prompt-generator";
import { generateICP, type GeneratedICP, type CompanyProfileInput } from "./icp-generation";

export interface AutoSetupInput {
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

export interface AutoSetupResult {
  success: boolean;
  ragBuilt: boolean;
  ragChunks: number;
  promptsGenerated: boolean;
  icpGenerated: boolean;
  companyName: string;
  errors: string[];
}

/**
 * Post-onboarding setup: generates sales prompts, builds RAG knowledge base,
 * and generates ICP — all automatically after company profile confirmation.
 * Designed to make the system ready for voice calls and messaging.
 */
export async function autoSetupAfterOnboarding(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  companyProfile: AutoSetupInput,
): Promise<AutoSetupResult> {
  const errors: string[] = [];
  let ragBuilt = false;
  let ragChunks = 0;
  let promptsGenerated = false;
  let icpGenerated = false;

  // 1. Build RAG knowledge base from company website
  if (companyProfile.website) {
    try {
      const ragInput: CompanyProfileForRAG = {
        companyName: companyProfile.companyName,
        website: companyProfile.website,
        industry: companyProfile.industry,
        description: companyProfile.description,
      };
      const ragData = await buildBusinessRAG(db, tenantId, ragInput);
      ragBuilt = true;
      ragChunks = ragData.totalChunks;
      console.log(`[auto-setup] RAG built: ${ragChunks} chunks from ${ragData.sourceUrls.length} pages`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "RAG build failed";
      errors.push(msg);
      console.warn("[auto-setup] RAG build failed:", err);
    }
  }

  // 2. Generate ICP (Ideal Customer Profile)
  let icp: GeneratedICP;
  try {
    const icpInput: CompanyProfileInput = {
      companyName: companyProfile.companyName,
      website: companyProfile.website,
      industry: companyProfile.industry,
      description: companyProfile.description,
      location: companyProfile.location,
      products: companyProfile.products,
      targetMarket: companyProfile.targetMarket,
    };
    icp = await generateICP(db, tenantId, icpInput);
    icpGenerated = true;
    console.log(`[auto-setup] ICP generated: ${icp.target_industries.length} industries, ${icp.target_titles.length} titles`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ICP generation failed";
    errors.push(msg);
    console.warn("[auto-setup] ICP generation failed:", err);
    // Fallback ICP for prompt generation
    icp = {
      target_industries: [companyProfile.industry],
      target_titles: ["CEO", "VP Sales", "Head of Growth"],
      target_seniorities: ["c_suite", "vp", "head"],
      target_company_sizes: ["11-50", "51-200"],
      target_locations: [companyProfile.location],
      keywords: companyProfile.industry.split(/\s+/).filter((w) => w.length > 2),
      scoring_weights: { industry: 0.3, title: 0.25, company_size: 0.2, location: 0.15, seniority: 0.1 },
    };
  }

  // 3. Generate sales prompts (system, opening, qualification, pitch, objection, closing)
  try {
    const promptInput: CompanyProfileForPrompts = {
      companyName: companyProfile.companyName,
      website: companyProfile.website,
      industry: companyProfile.industry,
      description: companyProfile.description,
      location: companyProfile.location,
      products: companyProfile.products,
      targetMarket: companyProfile.targetMarket,
      valueProposition: companyProfile.valueProposition,
      painPoints: companyProfile.painPoints,
      competitors: companyProfile.competitors,
    };
    const template = await generateSalesPrompt(db, tenantId, promptInput, icp);
    promptsGenerated = true;
    console.log(`[auto-setup] Sales prompts generated: v${template.promptVersion} (${template.id})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Prompt generation failed";
    errors.push(msg);
    console.warn("[auto-setup] Prompt generation failed:", err);
  }

  // 4. Mark onboarding as fully complete
  try {
    await db
      .update(schema.businessProfiles)
      .set({
        researchStatus: "completed",
        updatedAt: new Date(),
      })
      .where(eq(schema.businessProfiles.organizationId, tenantId));
  } catch (err) {
    console.warn("[auto-setup] Failed to update research status:", err);
  }

  return {
    success: errors.length === 0,
    ragBuilt,
    ragChunks,
    promptsGenerated,
    icpGenerated,
    companyName: companyProfile.companyName,
    errors,
  };
}
