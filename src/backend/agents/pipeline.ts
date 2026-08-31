import type { Agent, AgentContext, MessageBus, ContextStore, PipelineResult, PipelineStage } from "./types";
import { createMemoryBus } from "./bus";
import { createRedisStore, type RedisStore } from "./context";

// ── Pipeline Orchestrator ──
// Per-lead: Consent → Dialer → Nudge (with retry/parked/booked routing)
// Batch orchestration (Scout → Ranker) lives in /api/run
// Error handling: failures go to DLQ, transient errors retry via queue

export interface PipelineConfig {
  bus?: MessageBus;
  store?: RedisStore;
  agents: {
    consent?: Agent;
    dialer?: Agent;
    nudge?: Agent;
  };
}

export function createPipeline(config: PipelineConfig) {
  const bus = config.bus || createMemoryBus();
  const store = config.store || createRedisStore();

  function makeCtx(leadId: string, clientId: string): AgentContext {
    return {
      leadId,
      clientId,
      bus,
      store,
      log: (msg, data) => console.log(`[${leadId}] ${msg}`, data || ""),
    };
  }

  async function runStage<I, O>(
    agent: Agent<I, O> | undefined,
    input: I,
    ctx: AgentContext,
    stage: PipelineStage,
  ): Promise<{ output: O; ms: number } | { error: string; ms: number }> {
    if (!agent) return { error: `agent ${stage} not registered`, ms: 0 };
    const t0 = Date.now();
    try {
      const output = await agent.execute(input, ctx);
      return { output, ms: Date.now() - t0 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log(`ERROR ${stage}`, msg);
      bus.publish({ type: "error", leadId: ctx.leadId, clientId: ctx.clientId, agent: stage, error: msg });
      return { error: msg, ms: Date.now() - t0 };
    }
  }

  // run full pipeline for one lead
  async function runLead(leadId: string, clientId: string, pitch?: string): Promise<PipelineResult> {
    const t0 = Date.now();
    const ctx = makeCtx(leadId, clientId);

    // 1. Consent check (skip if already approved)
    const consentResult = await runStage(config.agents.consent, { leadId, clientId }, ctx, "consent");
    if ("error" in consentResult) {
      return { leadId, clientId, stage: "dlq", error: consentResult.error, durationMs: Date.now() - t0 };
    }
    const consent = consentResult.output as { approved: boolean; reason: string };
    if (!consent.approved) {
      bus.publish({ type: "consent.checked", leadId, clientId, approved: false });
      return { leadId, clientId, stage: "parked", outcome: consent.reason, durationMs: Date.now() - t0 };
    }

    // 2. Dial
    const dialResult = await runStage(config.agents.dialer, { leadId, clientId, pitch }, ctx, "dialer");
    if ("error" in dialResult) {
      return { leadId, clientId, stage: "dlq", error: dialResult.error, durationMs: Date.now() - t0 };
    }
    const dial = dialResult.output as { callId: string; outcome: string; bant: unknown };

    bus.publish({ type: "call.ended", leadId, clientId, callId: dial.callId, outcome: dial.outcome });

    // 3. Route by outcome
    switch (dial.outcome) {
      case "no_answer":
      case "failed": {
        const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
        // Persist retry so it survives restart
        try {
          const { db, schema } = await import("../db");
          const { randomUUID } = await import("crypto");
          await db.insert(schema.retryQueue).values({
            id: randomUUID(),
            leadId,
            clientId,
            callId: dial.callId,
            reason: dial.outcome,
            nextAttemptAt: next,
          });
        } catch {
          ctx.log("retryQueue insert failed");
        }
        bus.publish({ type: "retry.scheduled", leadId, clientId, nextAttemptAt: next.toISOString() });
        return { leadId, clientId, stage: "retry", outcome: dial.outcome, durationMs: Date.now() - t0 };
      }
      case "not_interested":
        return { leadId, clientId, stage: "parked", outcome: dial.outcome, durationMs: Date.now() - t0 };
      case "interested":
      case "booked": {
        // nudge sends info + meeting link
        const nudgeResult = await runStage(
          config.agents.nudge,
          { leadId, clientId, callId: dial.callId, outcome: dial.outcome, bant: dial.bant },
          ctx,
          "nudge",
        );
        if ("error" in nudgeResult) {
          return { leadId, clientId, stage: "dlq", error: nudgeResult.error, durationMs: Date.now() - t0 };
        }
        const nudge = nudgeResult.output as { meetingBooked: boolean };
        if (nudge.meetingBooked) {
          bus.publish({ type: "meeting.booked", leadId, clientId });
          return { leadId, clientId, stage: "booked", outcome: "booked", durationMs: Date.now() - t0 };
        }
        return { leadId, clientId, stage: "nudge", outcome: "info_sent", durationMs: Date.now() - t0 };
      }
      default:
        return { leadId, clientId, stage: "dlq", outcome: dial.outcome, error: "unknown outcome", durationMs: Date.now() - t0 };
    }
  }

  // batch: run multiple leads
  async function runBatch(leadIds: string[], clientId: string): Promise<PipelineResult[]> {
    const results: PipelineResult[] = [];
    for (const leadId of leadIds) {
      results.push(await runLead(leadId, clientId));
    }
    return results;
  }

  return { runLead, runBatch, bus, store };
}

export type Pipeline = ReturnType<typeof createPipeline>;
