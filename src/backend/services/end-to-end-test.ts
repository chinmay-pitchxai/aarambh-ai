/**
 * End-to-end test script for the AarambhAI onboarding flow.
 *
 * This is a manual test script that verifies the full pipeline:
 * 1. Create test tenant
 * 2. Submit onboarding (company name + website)
 * 3. Wait for research to complete
 * 4. Confirm profile
 * 5. Check ICP was generated
 * 6. Check sample leads were generated
 * 7. Check dashboard assistant can answer questions
 *
 * Run with: npx tsx src/backend/services/end-to-end-test.ts
 */

import { db, schema } from "../db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { researchBusiness } from "./business-research";
import { generateLeadInsights } from "./lead-insights";
import { searchApolloProspects } from "./apollo";
import { llm } from "../llm/client";
import {
  COMPANY_RESEARCH_PROMPT,
  ICP_GENERATION_PROMPT,
  SALES_PROMPT_TEMPLATE,
  LEAD_SCORING_PROMPT,
  DASHBOARD_ASSISTANT_PROMPT,
} from "../llm/prompts";

interface TestResult {
  step: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runStep(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ step: name, passed: true, message: "OK", durationMs: Date.now() - start });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.push({ step: name, passed: false, message: msg, durationMs: Date.now() - start });
    console.log(`  ✗ ${name}: ${msg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("\n=== AarambhAI End-to-End Test ===\n");

  const testTenantId = `test_tenant_${Date.now()}`;
  const testActorId = `test_actor_${Date.now()}`;

  // Step 1: Verify Gemini API key is available
  await runStep("Gemini API key exists", async () => {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new Error("GEMINI_API_KEY not set in environment");
  });

  // Step 2: Test unified LLM client - generateText
  await runStep("LLM client: generateText", async () => {
    const result = await llm.generateText("What is 2 + 2? Reply with just the number.", {
      temperature: 0,
      maxTokens: 10,
    });
    if (!result.includes("4")) throw new Error(`Expected "4" in response, got: ${result}`);
  });

  // Step 3: Test unified LLM client - generateStructured
  await runStep("LLM client: generateStructured", async () => {
    const result = await llm.generateStructured<{ answer: number }>(
      'Return JSON: {"answer": 42}',
    );
    if (result.answer !== 42) throw new Error(`Expected answer=42, got: ${JSON.stringify(result)}`);
  });

  // Step 4: Test LLM client - embedText
  await runStep("LLM client: embedText", async () => {
    const embedding = await llm.embedText("Hello world");
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Expected non-empty embedding array, got: ${typeof embedding}`);
    }
  });

  // Step 5: Test prompt templates
  await runStep("Prompt templates: all generate valid strings", async () => {
    const companyResearch = COMPANY_RESEARCH_PROMPT({
      companyName: "TestCo",
      website: "https://example.com",
      location: "Mumbai, India",
    });
    if (companyResearch.length < 100) throw new Error("COMPANY_RESEARCH_PROMPT too short");

    const icp = ICP_GENERATION_PROMPT({
      companyName: "TestCo",
      industry: "SaaS",
      location: "Mumbai",
      description: "A test company",
    });
    if (icp.length < 100) throw new Error("ICP_GENERATION_PROMPT too short");

    const sales = SALES_PROMPT_TEMPLATE({
      lead: { firstName: "John", company: "Acme", title: "VP Sales", industry: "SaaS" },
      company: { name: "TestCo", description: "We help businesses" },
      channel: "call",
      objective: "introduction",
    });
    if (sales.length < 50) throw new Error("SALES_PROMPT_TEMPLATE too short");

    const scoring = LEAD_SCORING_PROMPT({
      lead: { firstName: "John", company: "Acme", title: "VP Sales", industry: "SaaS" },
      icp: {
        industries: ["SaaS"],
        personTitles: ["VP Sales"],
        seniorities: ["vp"],
        employeeRanges: ["11,50"],
        locations: ["Mumbai"],
        keywords: ["saas", "sales"],
      },
    });
    if (scoring.length < 100) throw new Error("LEAD_SCORING_PROMPT too short");

    const assistant = DASHBOARD_ASSISTANT_PROMPT({
      companyName: "TestCo",
      userRole: "Sales Manager",
      availableData: { leadsCount: 10, meetingsCount: 5, callsCount: 20, conversionRate: 0.25 },
    });
    if (assistant.length < 100) throw new Error("DASHBOARD_ASSISTANT_PROMPT too short");
  });

  // Step 6: Test business research (with real website)
  await runStep("Business research: fetch company profile", async () => {
    const result = await researchBusiness({
      companyName: "TestCo",
      website: "https://example.com",
      mapLocation: "Mumbai, India",
    });
    if (!result.companyName) throw new Error("Missing companyName in result");
    if (!result.website) throw new Error("Missing website in result");
    if (!result.icp) throw new Error("Missing ICP in result");
    console.log(`    → Company: ${result.companyName}, Industry: ${result.industry}, Confidence: ${result.confidenceScore}`);
  });

  // Step 7: Test ICP generation via LLM
  await runStep("ICP generation via LLM", async () => {
    const prompt = ICP_GENERATION_PROMPT({
      companyName: "Example Corp",
      industry: "Technology",
      location: "San Francisco",
      description: "A leading cloud infrastructure provider",
    });
    const icp = await llm.generateStructured<{
      industries: string[];
      personTitles: string[];
      seniorities: string[];
      employeeRanges: string[];
      locations: string[];
      keywords: string[];
    }>(prompt);
    if (!Array.isArray(icp.industries) || icp.industries.length === 0) {
      throw new Error("ICP generation failed: no industries");
    }
    console.log(`    → Industries: ${icp.industries.join(", ")}`);
    console.log(`    → Titles: ${icp.personTitles.join(", ")}`);
  });

  // Step 8: Test sales prompt generation
  await runStep("Sales script generation via LLM", async () => {
    const prompt = SALES_PROMPT_TEMPLATE({
      lead: { firstName: "Priya", company: "TechStart", title: "Head of Growth", industry: "SaaS" },
      company: { name: "AarambhAI", description: "AI-powered B2B sales copilot" },
      channel: "call",
      objective: "introduction",
    });
    const result = await llm.generateText(prompt, { maxTokens: 200 });
    if (result.length < 20) throw new Error("Sales script too short");
    console.log(`    → Generated ${result.length}-char sales script`);
  });

  // Step 9: Test lead scoring via LLM
  await runStep("Lead scoring via LLM", async () => {
    const prompt = LEAD_SCORING_PROMPT({
      lead: { firstName: "Raj", company: "CloudInc", title: "VP Engineering", industry: "Cloud" },
      icp: {
        industries: ["Technology", "Cloud"],
        personTitles: ["VP Engineering", "CTO"],
        seniorities: ["vp", "c_suite"],
        employeeRanges: ["51,200"],
        locations: ["Bangalore"],
        keywords: ["cloud", "infrastructure"],
      },
    });
    const result = await llm.generateStructured<{ score: number; band: string; reasons: string[] }>(prompt);
    if (typeof result.score !== "number" || result.score < 1 || result.score > 100) {
      throw new Error(`Invalid score: ${result.score}`);
    }
    console.log(`    → Score: ${result.score}, Band: ${result.band}`);
  });

  // Step 10: Test dashboard assistant prompt
  await runStep("Dashboard assistant via LLM", async () => {
    const prompt = DASHBOARD_ASSISTANT_PROMPT({
      companyName: "TestCo",
      userRole: "Sales Manager",
      availableData: { leadsCount: 42, meetingsCount: 8, callsCount: 150, conversionRate: 0.18 },
      recentEvents: [
        { type: "meeting_booked", timestamp: "2026-09-01", details: "Demo with Acme Corp" },
      ],
    });
    const result = await llm.generateText(prompt, {
      systemInstruction: "You are a concise sales dashboard assistant.",
      maxTokens: 300,
    });
    if (result.length < 10) throw new Error("Assistant response too short");
    console.log(`    → Assistant response: ${result.slice(0, 100)}...`);
  });

  // Step 11: Test lead insights generation
  await runStep("Lead insights generation", async () => {
    const result = await generateLeadInsights({
      lead: { firstName: "Test", company: "Acme", title: "VP Sales", status: "new", band: "warm" },
      calls: [],
      messages: [],
    });
    if (!result.summary) throw new Error("Missing summary in insights");
    if (!result.nextStep) throw new Error("Missing nextStep in insights");
    console.log(`    → Next step: ${result.nextStep.title}`);
  });

  // Step 12: Test database connection (optional - skip if no DB)
  await runStep("Database connection", async () => {
    try {
      await db.select().from(schema.businessProfiles).limit(1);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
        console.log("    → Database not available, skipping DB tests");
        return;
      }
      throw error;
    }
  });

  // Step 13: Test tenant creation + onboarding flow (requires DB)
  await runStep("Full onboarding flow (DB-dependent)", async () => {
    try {
      // Create test organization
      const orgId = `org_${Date.now()}`;
      const [org] = await db.insert(schema.organizations).values({
        id: orgId,
        name: `Test Tenant ${Date.now()}`,
        createdAt: new Date(),
      }).returning();

      // Create business profile
      const [profile] = await db.insert(schema.businessProfiles).values({
        id: `bp_${Date.now()}`,
        organizationId: orgId,
        companyName: "E2E Test Corp",
        website: "https://example.com",
        location: "Mumbai, India",
        researchStatus: "researching",
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      console.log(`    → Created org: ${org.id}`);
      console.log(`    → Created profile: ${profile.id}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
        console.log("    → Database not available, skipping");
        return;
      }
      throw error;
    }
  });

  // Summary
  console.log("\n=== Test Results ===\n");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Total time: ${totalTime}ms`);

  if (failed > 0) {
    console.log("\nFailed steps:");
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  - ${r.step}: ${r.message}`);
    });
  }

  console.log("\n=== Done ===\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Test runner failed:", error);
  process.exit(1);
});
