import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createCompanyOnboardingGraph, graphInvocationConfig } from "./graph";
import { DEFAULT_SPECIALIST_RUNTIME_CONFIG, type SpecialistExecutor } from "./specialists";
import type { CompanyOnboardingInput, SpecialistFinding } from "./contracts";

const INPUT: CompanyOnboardingInput = {
  schemaVersion: 1,
  runId: "44d2548c-57e7-4b6e-8463-213f9ba920b5",
  threadId: "onboarding-test",
  tenantId: "tenant-1",
  actorId: "actor-1",
  correlationId: "correlation-1",
  causationId: null,
  inputEventId: "event-1",
  companyId: "company-1",
  companyProfileVersion: 1,
  configSnapshotId: "config-1",
  policySnapshotId: "policy-1",
  companyName: "Example Company",
  website: "https://example.com/",
  location: "Pune, India",
  suppliedEvidence: [{ uri: "https://example.com/", label: "Company website" }],
  createdAt: "2026-09-02T00:00:00.000Z",
};

describe("CompanyOnboardingGraph", () => {
it("fans out exactly five specialists, reduces deterministically, and resumes confirmation", async () => {
  const calls: string[] = [];
  let releaseAll!: () => void;
  const barrier = new Promise<void>((resolve) => { releaseAll = resolve; });
  const executor: SpecialistExecutor = {
    async execute(definition): Promise<SpecialistFinding> {
      calls.push(definition.id);
      if (calls.length === 5) releaseAll();
      await barrier;
      return {
        specialistId: definition.id,
        claims: [{ field: "industry", value: definition.id, sourceUris: ["https://example.com/"] }],
        sources: [{ uri: "https://example.com/", label: "Company website" }],
        confidence: 0.8,
        gaps: [],
        warnings: [],
      };
    },
  };
  const graph = createCompanyOnboardingGraph({
    checkpointer: new MemorySaver(),
    executor,
    now: () => new Date("2026-09-02T01:00:00.000Z"),
  });
  const config = graphInvocationConfig(INPUT.threadId);

  const paused = await graph.invoke({ input: INPUT }, config);
  expect([...calls].sort()).toEqual(DEFAULT_SPECIALIST_RUNTIME_CONFIG.definitions.map(({ id }) => id).sort());
  expect(paused.currentStatus).toBe("awaiting_confirmation");
  expect(paused.specialistFindings).toHaveLength(5);
  expect(paused.specialistFindings.map(({ specialistId }) => specialistId)).toEqual([...calls].sort());
  expect(paused.profileDraft?.claims.industry).toHaveLength(5);
  expect((paused as typeof paused & { __interrupt__?: unknown[] }).__interrupt__).toHaveLength(1);

  const completed = await graph.invoke(new Command({ resume: { action: "approve" } }), config);
  expect(completed.currentStatus).toBe("confirmed");
  expect(completed.decision).toEqual({ action: "approve" });
  expect(completed.proposedActions).toEqual([]);
  expect(completed.toolReceipts).toEqual([]);
});

it("rejects a specialist configuration that is not the exact five-agent set", () => {
  expect(() => createCompanyOnboardingGraph({
    checkpointer: new MemorySaver(),
    specialists: { ...DEFAULT_SPECIALIST_RUNTIME_CONFIG, definitions: DEFAULT_SPECIALIST_RUNTIME_CONFIG.definitions.slice(0, 4) },
  })).toThrow(/exactly these five specialists/);
});
});
