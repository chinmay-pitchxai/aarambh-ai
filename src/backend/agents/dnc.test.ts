import { describe, expect, it, beforeEach, vi } from "vitest";
import { consentAgent } from "./consent";
import type { AgentContext } from "./types";
import {
  mockDb,
  mockInsertResolving,
  mockSelectSequential,
  mockUpdateResolving,
} from "@/test-utils/mocks";

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

function leadRow(dnc = 0) {
  return { id: "lead-1", dnc };
}

describe("consent / DNC gate", () => {
  beforeEach(() => {
    mockInsertResolving();
    mockUpdateResolving();
  });

  it("blocks outreach when the lead is on the global DNC list", async () => {
    mockSelectSequential([[leadRow(1)]]);

    const out = await consentAgent.execute({ leadId: "lead-1", clientId: "client-1" }, makeCtx());

    expect(out).toEqual({ approved: false, reason: "global_dnc" });
    expect(mockDb.query.consent.findFirst).not.toHaveBeenCalled();
  });

  it("blocks outreach when the client explicitly opted out", async () => {
    mockSelectSequential([[leadRow(0)], [{ status: "opted_out", source: "manual" }]]);

    const out = await consentAgent.execute({ leadId: "lead-1", clientId: "client-1" }, makeCtx());

    expect(out).toEqual({ approved: false, reason: "client_opted_out" });
  });

  it("rejects when the lead is not found", async () => {
    mockSelectSequential([[]]);

    const out = await consentAgent.execute({ leadId: "lead-missing", clientId: "client-1" }, makeCtx());

    expect(out).toEqual({ approved: false, reason: "lead not found" });
  });

  it("defaults an unknown (no consent record) to implied B2B consent and inserts opted_in", async () => {
    mockSelectSequential([[leadRow(0)], []]);

    const out = await consentAgent.execute({ leadId: "lead-1", clientId: "client-1" }, makeCtx());

    expect(out).toEqual({ approved: true, reason: "implied_b2b_consent" });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("approves an opted_in record and records the checkedAt timestamp", async () => {
    mockSelectSequential([[leadRow(0)], [{ status: "opted_in" }]]);

    const out = await consentAgent.execute({ leadId: "lead-1", clientId: "client-1" }, makeCtx());

    expect(out).toEqual({ approved: true, reason: "opted_in" });
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("blocks an unknown consent status", async () => {
    mockSelectSequential([[leadRow(0)], [{ status: "unknown" }]]);

    const out = await consentAgent.execute({ leadId: "lead-1", clientId: "client-1" }, makeCtx());

    expect(out).toEqual({ approved: false, reason: "consent_unknown" });
  });
});
