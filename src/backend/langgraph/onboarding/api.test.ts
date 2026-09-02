import { MemorySaver } from "@langchain/langgraph";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/backend/db/schema";
import {
  confirmProfile,
  editDraft,
  getDraft,
  getRunStatus,
  listOnboardingRuns,
  OnboardingError,
  startOnboarding,
} from "@/backend/onboarding/service";
import { mockDb } from "@/test-utils/mocks";
import { createCompanyOnboardingGraph } from "./graph";
import type { SpecialistExecutor } from "./specialists";

type Row = Record<string, unknown>;
type StoreKey = "graphRuns" | "businessProfiles" | "outboxEvents";

// In-memory store backing the mocked drizzle `db` chains. The global test setup
// replaces @/backend/db with mockDb (vi.fn()); we wire stateful chains here so
// the full submit → status → edit → confirm flow can be asserted end to end.
const store: Record<StoreKey, Row[]> = { graphRuns: [], businessProfiles: [], outboxEvents: [] };

function tableName(table: unknown): StoreKey {
  if (table === schema.graphRuns) return "graphRuns";
  if (table === schema.businessProfiles) return "businessProfiles";
  if (table === schema.outboxEvents) return "outboxEvents";
  throw new Error(`Unexpected table: ${String(table)}`);
}

function wireMockDb() {
  mockDb.select.mockImplementation(() => ({
    from: (table: unknown) => {
      const name = tableName(table);
      let limit = store[name].length;
      const chain = {
        where: () => chain,
        orderBy: () => chain,
        limit: (value: number) => {
          limit = value;
          return chain;
        },
        offset: () => chain,
        then: (onFulfilled?: (value: Row[]) => unknown, onRejected?: (reason: unknown) => unknown) =>
          Promise.resolve(store[name].slice(0, limit)).then(onFulfilled, onRejected),
      };
      return chain;
    },
  }));

  mockDb.insert.mockImplementation((table: unknown) => {
    const name = tableName(table);
    return {
      values: (row: Row) => {
        let committed = false;
        const thenable = {
          then: (onFulfilled?: (value: Row[]) => unknown, onRejected?: (reason: unknown) => unknown) => {
            if (!committed) {
              store[name].push({ ...row });
              committed = true;
            }
            return Promise.resolve([row]).then(onFulfilled, onRejected);
          },
          onConflictDoUpdate: () => {
            if (!committed) {
              const existingIndex = store[name].findIndex((existing) => existing.id === row.id);
              if (existingIndex >= 0) {
                store[name][existingIndex] = { ...store[name][existingIndex], ...row };
              } else {
                store[name].push({ ...row });
              }
              committed = true;
            }
            return thenable;
          },
          onConflictDoNothing: () => {
            if (!committed) {
              store[name].push({ ...row });
              committed = true;
            }
            return thenable;
          },
          returning: () => {
            if (!committed) {
              store[name].push({ ...row });
              committed = true;
            }
            return [row];
          },
        };
        return thenable;
      },
    };
  });

  mockDb.update.mockImplementation((table: unknown) => {
    const name = tableName(table);
    return {
      set: (patch: Row) => ({
        where: () => ({
          then: (onFulfilled?: (value: undefined) => unknown, onRejected?: (reason: unknown) => unknown) => {
            if (store[name].length > 0) {
              const target = store[name][0];
              const index = store[name].indexOf(target);
              store[name][index] = { ...target, ...patch };
            }
            return Promise.resolve(undefined).then(onFulfilled, onRejected);
          },
        }),
      }),
    };
  });
}

const executor: SpecialistExecutor = {
  async execute(definition, input) {
    return {
      specialistId: definition.id,
      claims: [{ field: "industry", value: definition.id, sourceUris: [input.website] }],
      sources: input.suppliedEvidence,
      confidence: 0.8,
      gaps: [],
      warnings: [],
    };
  },
};

describe("Onboarding service (v1 API)", () => {
  const graph = createCompanyOnboardingGraph({
    checkpointer: new MemorySaver(),
    executor,
    now: () => new Date("2026-09-02T02:00:00.000Z"),
  });
  const db = mockDb as unknown as Parameters<typeof startOnboarding>[0];
  const ctx = { tenantId: "tenant-1", actorId: "actor-1" };
  const runtime = { graph };

  beforeEach(() => {
    store.graphRuns = [];
    store.businessProfiles = [];
    store.outboxEvents = [];
    wireMockDb();
  });

  it("submits, researches, edits, confirms, and emits company.profile_confirmed", async () => {
    const started = await startOnboarding(
      db,
      ctx,
      { companyName: "Example Company", website: "example.com", location: "Pune, India" },
      runtime,
    );

    expect(started.status).toBe("awaiting_confirmation");
    expect(started.runId).toBe(started.threadId);
    expect(started.companyId).toBeTruthy();

    expect(store.graphRuns).toHaveLength(1);
    expect(store.graphRuns[0]).toMatchObject({
      status: "running",
      graphName: "company_onboarding",
      tenantId: "tenant-1",
    });
    expect(store.graphRuns[0].metadata).toMatchObject({ threadId: started.threadId, companyId: started.companyId });

    expect(store.businessProfiles).toHaveLength(1);
    expect(store.businessProfiles[0]).toMatchObject({
      companyName: "Example Company",
      website: "https://example.com",
      researchStatus: "partial",
      organizationId: "tenant-1",
    });

    const status = await getRunStatus(db, ctx, started.threadId, runtime);
    expect(status.status).toBe("awaiting_confirmation");
    expect(status.specialistFindings).toHaveLength(5);
    expect(status.profileDraft?.claims.industry).toHaveLength(5);

    const draft = await getDraft(db, ctx, started.threadId, runtime);
    expect(draft.profile.claims.industry).toHaveLength(5);
    expect(draft.profile.companyName).toBe("Example Company");
    expect(draft.profile.location).toBe("Pune, India");

    const edited = await editDraft(db, ctx, started.threadId, { description: "Edited description" }, runtime);
    expect(edited.profile.description).toBe("Edited description");

    const confirmed = await confirmProfile(db, ctx, started.threadId, runtime);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.decision).toEqual({ action: "approve" });
    expect(confirmed.profile.claims.industry).toHaveLength(5);

    expect(store.businessProfiles[0]).toMatchObject({
      researchStatus: "completed",
      confidenceScore: 80,
      description: "Edited description",
    });

    expect(store.graphRuns[0]).toMatchObject({ status: "completed" });

    expect(store.outboxEvents).toHaveLength(1);
    expect(store.outboxEvents[0]).toMatchObject({
      tenantId: "tenant-1",
      eventType: "company.profile_confirmed",
      aggregateType: "company_profile",
      aggregateId: started.companyId,
    });

    const runs = await listOnboardingRuns(db, ctx, { limit: 10 });
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe(started.threadId);
    expect(runs[0].runStatus).toBe("completed");
  });

  it("rejects invalid submit input before touching persistence", async () => {
    await expect(
      startOnboarding(db, ctx, { companyName: "X", website: "not-a-url" }, runtime),
    ).rejects.toThrow();
    expect(store.graphRuns).toHaveLength(0);
    expect(store.businessProfiles).toHaveLength(0);
  });

  it("returns a 404-style error for an unknown run", async () => {
    await expect(getRunStatus(db, ctx, "missing-thread", runtime)).rejects.toThrow(OnboardingError);
  });
});
