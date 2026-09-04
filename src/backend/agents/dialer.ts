import type { Agent, AgentContext, DialerInput, DialerOutput, callOutcome } from "./types";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getTenantVobizConfig } from "../telephony/tenant-telephony";
import { serverConfig } from "../config";

// ── Dialer Agent ──
// Submits a REAL outbound call through Vobiz (api.vobiz.ai).
// The final outcome arrives asynchronously via the provider status/hangup
// callback → /api/v1/webhooks/vobiz → outcome router. This agent NEVER
// fabricates outcomes: it records the call as provider-pending and returns
// outcome "initiated". Callers must not schedule follow-ups from this return
// value; the webhook-driven outcome router owns all post-call actions.

async function dialVobiz(phoneE164: string, clientId: string): Promise<{ callId: string; status: string }> {
  const { client, fromNumber } = await getTenantVobizConfig(db, clientId);
  const answerUrl = `${serverConfig.appUrl}/api/v1/webhooks/vobiz`;

  const result = await client.initiateCall(fromNumber, phoneE164, answerUrl, {
    timeout: 30,
    callbackUrl: answerUrl,
  });
  return { callId: result.callId, status: result.status };
}

async function getTranscript(_callId: string): Promise<Array<{ role: string; text: string }>> {
  // Transcripts are produced by our own voice pipeline (Gemini Live) and
  // attached to the call record, not by the telephony provider.
  void _callId;
  return [];
}

export const dialerAgent: Agent<DialerInput, DialerOutput> = {
  name: "dialer",

  async execute(input, ctx) {
    const { leadId, clientId, pitch, attemptNumber = 1 } = input;
    ctx.log("dialer start", { leadId, attemptNumber });

    // 1. Fetch lead
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);

    if (!lead) throw new Error(`Lead ${leadId} not found`);
    if (!lead.phoneE164) throw new Error(`No phone for lead ${leadId}`);

    // 2. Recall memory for context
    const memory = await ctx.store.recall(leadId);
    const contextSnippet = memory.calls.length > 0
      ? `Previous: ${memory.calls[memory.calls.length - 1].summary}`
      : "First contact.";

    // 3. Generate pitch via LLM if not provided
    let finalPitch = pitch;
    if (!finalPitch) {
      try {
        const { llmLabAgent } = await import("./llm-lab");
        const result = await llmLabAgent.execute(
          {
            action: "generate_pitch",
            lead: {
              company: lead.company,
              title: lead.title,
              industry: lead.industry,
              firstName: lead.firstName,
            },
            previousContext: contextSnippet,
          },
          ctx,
        );
        finalPitch = result.pitch || `Hello, I'm calling from AarambhAI. ${contextSnippet}`;
      } catch {
        finalPitch = `Hello, I'm calling from AarambhAI. ${contextSnippet}`;
      }
    }

    // 4. Dial via the real Vobiz API. The provider returns a call UUID;
    // the terminal outcome arrives later through its status/hangup callback.
    const { callId, status } = await dialVobiz(lead.phoneE164, clientId);
    ctx.log("dialer submitted real call", { callId, status });

    // Record the call as provider-pending. Outcome, duration, transcript,
    // analysis and recording are filled in by the webhook-driven flow —
    // never simulated here.
    const outcome: callOutcome = "initiated";
    const summary = `Outbound call submitted to provider (uuid ${callId}). Awaiting provider outcome via webhook.`;
    const bant = { budget: "unknown", authority: "unknown", need: "unknown", timeline: "unknown" };
    const sentiment = "pending";

    // 7. Store pending call record
    const callIdDb = randomUUID();
    await db.insert(schema.calls).values({
      id: callIdDb,
      leadId,
      clientId,
      vobizCallId: callId,
      outcome: null,
      durationSec: null,
      transcript: [],
      bant,
      sentiment,
      pitchUsed: finalPitch,
      summary,
      attemptNumber,
      startedAt: new Date(),
    });

    // 8. Update memory (call submitted, outcome pending)
    const mem = await ctx.store.recall(leadId);
    mem.calls.push({ callId: callIdDb, outcome, summary, bant, at: new Date().toISOString() });
    mem.totalAttempts++;
    mem.lastSentiment = sentiment;
    mem.lastPitch = finalPitch;
    await ctx.store.saveMemory(mem);

    // 9. Update lead contact bookkeeping only — no fabricated status change
    await db
      .update(schema.clientLeads)
      .set({
        lastCallAt: new Date(),
        attemptCount: attemptNumber,
      })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

    return { callId: callIdDb, outcome, durationSec: 0, bant, sentiment, summary };
  },
};
