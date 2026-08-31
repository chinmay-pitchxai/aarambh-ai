import type { Agent, AgentContext, DialerInput, DialerOutput, callOutcome } from "./types";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Dialer Agent ──
// Vobiz telephony + Gemini Live voice
// 6 outcomes: no_answer, failed, not_interested, interested, booked, picked_no_response

const VOBIZ_API = process.env.VOBIZ_API_URL || "https://api.vobiz.in/v1";

async function dialVobiz(phoneE164: string): Promise<{ callId: string; status: string }> {
  const apiKey = process.env.VOBIZ_API_KEY;
  if (!apiKey) {
    return { callId: `dev-${randomUUID().slice(0, 8)}`, status: "connected" };
  }

  const res = await fetch(`${VOBIZ_API}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: phoneE164,
      from: process.env.VOBIZ_FROM_NUMBER,
      webhook: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/vobiz`,
    }),
  });

  if (!res.ok) throw new Error(`Vobiz dial failed: ${res.status}`);
  const data = await res.json();
  return { callId: data.call_id, status: data.status };
}

async function getTranscript(callId: string): Promise<Array<{ role: string; text: string }>> {
  const apiKey = process.env.VOBIZ_API_KEY;
  if (!apiKey) return [];

  const res = await fetch(`${VOBIZ_API}/calls/${callId}/transcript`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data.transcript || [];
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

    // 4. Dial
    const { callId, status } = await dialVobiz(lead.phoneE164);
    ctx.log("dialer connected", { callId, status });

    // 5. Simulate outcome
    const outcome = simulateOutcome(status);
    const durationSec = outcome === "no_answer" ? 0 : Math.floor(Math.random() * 300) + 30;

    // 6. Get transcript if connected
    const transcript = durationSec > 0 ? await getTranscript(callId) : [];

    // 7. Analyze via LLM Lab
    let bant = { budget: "unknown", authority: "unknown", need: "unknown", timeline: "unknown" };
    let sentiment = "neutral";
    let summary = "";

    if (transcript.length > 0) {
      try {
        const { llmLabAgent } = await import("./llm-lab");
        const analysis = await llmLabAgent.execute(
          { action: "analyze_transcript", transcript },
          ctx,
        );
        bant = analysis.bant || bant;
        sentiment = analysis.sentiment || sentiment;
        summary = analysis.summary || summary;
      } catch {
        ctx.log("LLM analysis failed, using defaults");
      }
    }

    // 8. Store call
    const callIdDb = randomUUID();
    await db.insert(schema.calls).values({
      id: callIdDb,
      leadId,
      clientId,
      vobizCallId: callId,
      outcome,
      durationSec,
      transcript,
      bant,
      sentiment,
      pitchUsed: finalPitch,
      summary,
      attemptNumber,
      startedAt: new Date(),
      endedAt: new Date(Date.now() + durationSec * 1000),
    });

    // 9. Update memory
    const mem = await ctx.store.recall(leadId);
    mem.calls.push({ callId: callIdDb, outcome, summary, bant, at: new Date().toISOString() });
    mem.totalAttempts++;
    mem.lastSentiment = sentiment;
    mem.lastPitch = finalPitch;
    await ctx.store.saveMemory(mem);

    // 10. Update lead status + lastCallAt
    const statusMap: Record<string, string> = {
      booked: "qualified",
      not_interested: "parked",
      picked_no_response: "contacted",
    };
    await db
      .update(schema.clientLeads)
      .set({
        status: (statusMap[outcome] || "contacted") as typeof schema.clientLeads.status.enumValues[number],
        lastCallAt: new Date(),
        attemptCount: attemptNumber,
      })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

    return { callId: callIdDb, outcome, durationSec, bant, sentiment, summary };
  },
};

function simulateOutcome(vobizStatus: string): callOutcome {
  if (vobizStatus === "no_answer" || vobizStatus === "busy") return vobizStatus === "busy" ? "failed" : "no_answer";
  if (vobizStatus === "connected") {
    const r = Math.random();
    if (r < 0.2) return "not_interested";
    if (r < 0.4) return "interested";
    if (r < 0.6) return "booked";
    if (r < 0.8) return "picked_no_response";
    return "no_answer";
  }
  return "failed";
}
