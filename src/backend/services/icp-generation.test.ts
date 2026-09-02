import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDb } from "../../test-utils/mocks";

vi.mock("../db", async () => {
  const { mockDb, mockSchema } = await import("../../test-utils/mocks");
  return { db: mockDb, schema: mockSchema };
});

import { generateICP, toIcpProfile, type CompanyProfileInput, type GeneratedICP } from "./icp-generation";
import { generateSalesPrompt, type CompanyProfileForPrompts } from "./sales-prompt-generator";
import { buildBusinessRAG, searchRAG, getRAGContext, type RAGData, type CompanyProfileForRAG } from "./rag-builder";

const mockCompanyProfile: CompanyProfileInput = {
  companyName: "TestSoft Solutions",
  website: "https://testsoft.example.com",
  industry: "SaaS",
  description: "Cloud-based project management software for enterprise teams.",
  location: "Bangalore, India",
  products: ["Project Management", "Team Collaboration", "Time Tracking"],
  targetMarket: "Mid-market enterprises",
  category: "Software",
};

const mockPromptsProfile: CompanyProfileForPrompts = {
  ...mockCompanyProfile,
  valueProposition: "30% faster project delivery with AI-powered scheduling",
  painPoints: ["missed deadlines", "resource allocation", "team visibility"],
  competitors: ["Asana", "Monday.com", "Jira"],
};

const mockICP: GeneratedICP = {
  target_industries: ["SaaS", "FinTech", "Healthcare"],
  target_titles: ["VP Engineering", "CTO", "Head of Product"],
  target_seniorities: ["c_suite", "vp", "director"],
  target_company_sizes: ["51-200", "201-500"],
  target_locations: ["Bangalore", "Mumbai", "Delhi NCR"],
  keywords: ["project management", "enterprise software", "SaaS", "team productivity"],
  scoring_weights: { industry: 0.3, title: 0.25, company_size: 0.2, location: 0.15, seniority: 0.1 },
};

function mockDbForICP(existingProfile: Record<string, unknown> | null = null) {
  mockDb.query.businessProfiles.findFirst.mockResolvedValue(existingProfile);
  mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
  mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
}

function mockDbForPrompts(existingProfile: Record<string, unknown> | null = null) {
  mockDb.query.businessProfiles.findFirst.mockResolvedValue(existingProfile);
  mockDb.query.promptTemplates.findFirst.mockResolvedValue(null);
  mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
  mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
}

describe("icp-generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("generates ICP from company profile using fallback when no API key", async () => {
    mockDbForICP();
    const result = await generateICP(mockDb as any, "tenant-1", mockCompanyProfile);
    expect(result.target_industries).toContain("SaaS");
    expect(result.target_titles.length).toBeGreaterThan(0);
    expect(result.target_seniorities.length).toBeGreaterThan(0);
    expect(result.target_company_sizes.length).toBeGreaterThan(0);
    expect(result.target_locations).toContain("Bangalore, India");
    expect(result.keywords.length).toBeGreaterThan(0);
    expect(result.scoring_weights.industry).toBeGreaterThan(0);
  });

  it("generates ICP with Gemini when API key is set", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockDbForICP();
    const geminiResponse = {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                target_industries: ["EdTech", "FinTech"],
                target_titles: ["CEO", "VP Sales", "Head of Operations"],
                target_seniorities: ["founder", "c_suite", "vp"],
                target_company_sizes: ["11-50", "51-200"],
                target_locations: ["Pune", "Hyderabad"],
                keywords: ["edtech", "saas", "learning platform"],
                scoring_weights: { industry: 0.35, title: 0.3, company_size: 0.15, location: 0.1, seniority: 0.1 },
              }),
            }],
          },
        }],
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(geminiResponse as Response);

    const result = await generateICP(mockDb as any, "tenant-1", mockCompanyProfile);
    expect(result.target_industries).toEqual(["EdTech", "FinTech"]);
    expect(result.target_titles).toEqual(["CEO", "VP Sales", "Head of Operations"]);
    expect(result.scoring_weights.industry).toBe(0.35);
  });

  it("stores ICP in business_profiles on existing record", async () => {
    mockDbForICP({ id: "bp-1", organizationId: "tenant-1", icpVersion: 2 });
    await generateICP(mockDb as any, "tenant-1", mockCompanyProfile);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("creates new business_profiles record if none exists", async () => {
    mockDbForICP(null);
    await generateICP(mockDb as any, "tenant-1", mockCompanyProfile);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("converts GeneratedICP to IcpProfile format", () => {
    const profile = toIcpProfile(mockICP);
    expect(profile.industries).toEqual(["SaaS", "FinTech", "Healthcare"]);
    expect(profile.personTitles).toEqual(["VP Engineering", "CTO", "Head of Product"]);
    expect(profile.seniorities).toEqual(["c_suite", "vp", "director"]);
    expect(profile.employeeRanges).toEqual(["51,200", "201,500"]);
    expect(profile.locations).toEqual(["Bangalore", "Mumbai", "Delhi NCR"]);
    expect(profile.keywords).toEqual(["project management", "enterprise software", "SaaS", "team productivity"]);
  });
});

describe("sales-prompt-generator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  it("generates sales prompts using fallback when no API key", async () => {
    mockDbForPrompts();
    const result = await generateSalesPrompt(mockDb as any, "tenant-1", mockPromptsProfile, mockICP);
    expect(result.systemPrompt).toContain("TestSoft Solutions");
    expect(result.systemPrompt).toContain("SaaS");
    expect(result.behaviorPrompt).toContain("TestSoft Solutions");
    expect(result.qualificationPrompt).toContain("TestSoft Solutions");
    expect(result.objectionPrompt).toContain("TestSoft Solutions");
    expect(result.closingPrompt).toContain("TestSoft Solutions");
    expect(result.status).toBe("active");
    expect(result.promptVersion).toBe(1);
  });

  it("uses Gemini to generate prompts when API key is set", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    mockDbForPrompts();
    const geminiResponse = {
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                system_prompt: "You are an AI SDR for TestSoft Solutions, a SaaS company.",
                behavior_prompt: "Be professional and concise.",
                qualification_prompt: "Use BANT framework tailored to SaaS.",
                objection_prompt: "Handle pricing and competitor objections.",
                closing_prompt: "Book demos with specific time slots.",
              }),
            }],
          },
        }],
      }),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(geminiResponse as Response);

    const result = await generateSalesPrompt(mockDb as any, "tenant-1", mockPromptsProfile, mockICP);
    expect(result.systemPrompt).toContain("TestSoft Solutions");
    expect(result.systemPrompt).not.toContain("[Company Name]");
  });

  it("generates company-specific fallback prompts not generic", async () => {
    mockDbForPrompts();
    const result = await generateSalesPrompt(mockDb as any, "tenant-1", mockPromptsProfile, mockICP);
    expect(result.systemPrompt).toContain("TestSoft Solutions");
    expect(result.behaviorPrompt).toContain("TestSoft Solutions");
    expect(result.qualificationPrompt).toContain("TestSoft Solutions");
    expect(result.objectionPrompt).toContain("TestSoft Solutions");
    expect(result.closingPrompt).toContain("TestSoft Solutions");
  });

  it("stores prompt in prompt_templates table", async () => {
    mockDbForPrompts();
    await generateSalesPrompt(mockDb as any, "tenant-1", mockPromptsProfile, mockICP);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});

describe("rag-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns fallback description chunk when no pages load", async () => {
    mockDb.query.businessProfiles.findFirst.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch disabled"));
    mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
    const result = await buildBusinessRAG(mockDb as any, "tenant-1", {
      companyName: "Test",
      website: "https://nonexistent.invalid",
      industry: "Tech",
      description: "Test",
    });
    expect(result.totalChunks).toBe(1);
    expect(result.chunks[0].category).toBe("about");
    expect(result.chunks[0].content).toContain("Test");
    vi.restoreAllMocks();
  });

  it("returns empty RAG data for localhost", async () => {
    mockDb.query.businessProfiles.findFirst.mockResolvedValue(null);
    const result = await buildBusinessRAG(mockDb as any, "tenant-1", {
      companyName: "Test",
      website: "http://localhost:3000",
      industry: "Tech",
      description: "Test",
    });
    expect(result.chunks).toEqual([]);
  });

  it("searchRAG returns relevant chunks sorted by score", () => {
    const ragData: RAGData = {
      chunks: [
        { id: "1", url: "https://example.com/about", title: "About Us", content: "We are a SaaS company specializing in project management software.", category: "about" },
        { id: "2", url: "https://example.com/products", title: "Our Products", content: "Our product suite includes task tracking, time logging, and team collaboration.", category: "products" },
        { id: "3", url: "https://example.com/faq", title: "FAQ", content: "Q: What is your pricing? A: We offer monthly and annual plans.", category: "faq" },
      ],
      builtAt: new Date().toISOString(),
      sourceUrls: ["https://example.com"],
      totalChunks: 3,
    };

    const results = searchRAG(ragData, "project management software");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("1");
  });

  it("getRAGContext returns formatted context string", () => {
    const ragData: RAGData = {
      chunks: [
        { id: "1", url: "https://example.com", title: "About", content: "Test content about our company.", category: "about" },
      ],
      builtAt: new Date().toISOString(),
      sourceUrls: ["https://example.com"],
      totalChunks: 1,
    };

    const context = getRAGContext(ragData, "company information");
    expect(context).toContain("Source:");
    expect(context).toContain("Test content about our company.");
  });

  it("getRAGContext returns empty string when no matches", () => {
    const ragData: RAGData = {
      chunks: [
        { id: "1", url: "https://example.com", title: "About", content: "Some unrelated content.", category: "about" },
      ],
      builtAt: new Date().toISOString(),
      sourceUrls: ["https://example.com"],
      totalChunks: 1,
    };

    const context = getRAGContext(ragData, "xyz123nonexistent");
    expect(context).toBe("");
  });

  it("stores RAG data in business_profiles", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      headers: { get: () => "text/html" },
      text: async () => "<html><head><title>Test Page</title></head><body><p>TestSoft is a SaaS platform for project management.</p></body></html>",
    } as unknown as Response);

    mockDb.query.businessProfiles.findFirst.mockResolvedValue({ id: "bp-1", organizationId: "tenant-1" });
    mockDb.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });

    const result = await buildBusinessRAG(mockDb as any, "tenant-1", {
      companyName: "TestSoft",
      website: "https://testsoft.example.com",
      industry: "SaaS",
      description: "Project management software",
    });

    expect(result.totalChunks).toBeGreaterThan(0);
    expect(mockDb.update).toHaveBeenCalled();
  });
});
