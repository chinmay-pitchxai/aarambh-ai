import { describe, expect, it, beforeEach, vi } from "vitest";
import { rankerAgent } from "./ranker";
import type { AgentContext, RankerInput } from "./types";
import { mockDb, mockSelectReturning, mockUpdateResolving } from "@/test-utils/mocks";

function makeCtx(): AgentContext {
  return {
    leadId: "lead-1",
    clientId: "client-1",
    bus: { publish: vi.fn(), subscribe: vi.fn() },
    store: {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      recall: vi.fn(),
      saveMemory: vi.fn(),
    },
    log: vi.fn(),
  };
}

interface LeadSignals {
  title: string | null;
  companySize: string | null;
  industry: string | null;
  city: string | null;
  freshness: Date | null;
}

function lead(signals: Partial<LeadSignals>): LeadSignals {
  return { title: null, companySize: null, industry: null, city: null, freshness: null, ...signals };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function run(input: RankerInput) {
  return rankerAgent.execute(input, makeCtx());
}

describe("ranker scoring", () => {
  beforeEach(() => {
    mockUpdateResolving();
  });

  it("scores a lead with no signals at the 50 baseline (warm)", async () => {
    mockSelectReturning([lead({})]);

    const out = await run({ leadIds: ["lead-1"], clientId: "client-1" });

    expect(out).toEqual({ scored: 1, hot: 0, warm: 1, cold: 0 });
  });

  it("handles an empty title without crashing", async () => {
    mockSelectReturning([lead({ title: "" })]);

    const out = await run({ leadIds: ["lead-1"], clientId: "client-1" });

    expect(out.warm).toBe(1);
  });

  it("clamps a very high score to 100 (hot) and persists it", async () => {
    mockSelectReturning([
      lead({ title: "Chief Executive Officer", companySize: "10001", industry: "SaaS software", city: "Bangalore", freshness: new Date() }),
    ]);
    const setValues = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDb.update.mockReturnValue({ set: setValues });

    const out = await run({ leadIds: ["lead-1"], clientId: "client-1" });

    expect(out).toEqual({ scored: 1, hot: 1, warm: 0, cold: 0 });
    expect(setValues).toHaveBeenCalledWith(expect.objectContaining({ score: 100, band: "hot" }));
  });

  it("marks exactly 70 as hot (upper band boundary)", async () => {
    mockSelectReturning([lead({ title: "VP Sales", freshness: daysAgo(40) })]);

    const out = await run({ leadIds: ["lead-1"], clientId: "client-1" });

    // 50 baseline + 25 (VP) - 5 (stale 31-60d) = 70 → hot
    expect(out.hot).toBe(1);
    expect(out.warm).toBe(0);
  });

  it("marks 68 as warm (just below the hot boundary)", async () => {
    mockSelectReturning([lead({ title: "Manager", city: "Gurgaon" })]);

    const out = await run({ leadIds: ["lead-1"], clientId: "client-1" });

    // 50 + 15 (manager) + 3 (gurgaon) = 68 → warm
    expect(out.warm).toBe(1);
    expect(out.hot).toBe(0);
  });

  it("marks the 40 floor as warm (lower band boundary)", async () => {
    mockSelectReturning([lead({ freshness: daysAgo(70) })]);

    const out = await run({ leadIds: ["lead-1"], clientId: "client-1" });

    // 50 - 10 (stale >60d) = 40 → warm, never cold
    expect(out.warm).toBe(1);
    expect(out.cold).toBe(0);
  });

  it("skips a lead that is not found instead of scoring it", async () => {
    mockSelectReturning([]);

    const out = await run({ leadIds: ["lead-missing"], clientId: "client-1" });

    expect(out).toEqual({ scored: 1, hot: 0, warm: 0, cold: 0 });
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
