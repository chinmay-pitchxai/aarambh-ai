import { randomUUID } from "crypto";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { getVobizClient, type TranscriptTurn } from "../integrations/vobiz";
import { serverConfig } from "../config";
import { getActivePromptTemplate, type CompanyProfileForPrompts } from "../services/sales-prompt-generator";
import { buildSystemPrompt, type CompanyProfile, type LeadProfile } from "./system-prompt-builder";
import { createGeminiLiveSession, type GeminiLiveSession } from "./gemini-live";
import type { DurableQueue } from "../queue/durable-queue";

// ── Voice Agent ──
// Orchestrates outbound voice calls using Gemini Live API + Vobiz telephony.
// Loads business context, builds system instruction, manages bidirectional audio,
// records transcripts, and routes outcomes on call completion.

export interface VoiceAgentInput {
  tenantId: string;
  leadId: string;
  fromNumber: string;
  attemptNumber?: number;
}

export interface VoiceAgentResult {
  callId: string;
  vobizCallId: string;
  outcome: string;
  transcript: TranscriptTurn[];
  summary: string;
  nextSteps: string;
  sentiment: string;
  durationSec: number;
}

/**
 * Initiates an outbound voice call using Gemini Live API for the AI brain
 * and Vobiz for telephony (call placement + audio bridging).
 */
export async function initiateVoiceCall(
  queue: DurableQueue,
  input: VoiceAgentInput,
): Promise<VoiceAgentResult> {
  const { tenantId, leadId, fromNumber, attemptNumber = 1 } = input;

  // 1. Load lead profile
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) throw new Error("Lead not found");
  if (!lead.phoneE164) throw new Error("Lead has no phone number");

  const leadProfile: LeadProfile = {
    firstName: lead.firstName ?? undefined,
    lastName: lead.lastName ?? undefined,
    company: lead.company ?? undefined,
    title: lead.title ?? undefined,
    city: lead.city ?? undefined,
    industry: lead.industry ?? undefined,
    companySize: lead.companySize ?? undefined,
  };

  // 2. Load company profile + RAG data
  const bizProfile = await db.query.businessProfiles.findFirst({
    where: eq(schema.businessProfiles.organizationId, tenantId),
  });

  const companyProfile: CompanyProfile = {
    companyName: bizProfile?.companyName ?? "Our Company",
    industry: bizProfile?.industry ?? "General",
    description: bizProfile?.description ?? "",
    location: bizProfile?.location ?? "India",
    website: bizProfile?.website ?? undefined,
    products: (bizProfile?.profileData as any)?.products ?? [],
    targetMarket: (bizProfile?.profileData as any)?.targetMarket ?? "",
    valueProposition: (bizProfile?.profileData as any)?.valueProposition ?? "",
  };

  // 3. Load sales prompt template
  const salesPrompt = await getActivePromptTemplate(db, tenantId);

  // 4. Build system instruction
  const systemInstruction = buildSystemPrompt(
    companyProfile,
    leadProfile,
    salesPrompt,
    {
      agentName: "Asha",
      gender: "female",
      voiceLanguage: serverConfig.voice.language,
    },
  );

  // 5. Create Gemini Live session
  const transcript: TranscriptTurn[] = [];
  let callEnded = false;
  let durationMs = 0;
  let callStartedAt = Date.now();
  let outcome: string = "picked_no_response";

  const geminiSession = await createGeminiLiveSession(
    {
      model: serverConfig.voice.model,
      voiceName: serverConfig.voice.name,
      systemInstruction,
    },
    {
      onUserTranscript(text) {
        transcript.push({ role: "user", text });
      },
      onAssistantTranscript(text) {
        transcript.push({ role: "assistant", text });
      },
      onInterruption() {
        // Gemini detected customer interruption — playback stops
      },
      onError(error) {
        console.error("[voice-agent] Gemini error:", error.message);
      },
    },
  );

  // 6. Initiate call via Vobiz
  const vobizClient = getVobizClient();
  const webhookUrl = `${serverConfig.appUrl}/api/v1/webhooks/vobiz`;

  const callResult = await vobizClient.initiateCall(fromNumber, lead.phoneE164, webhookUrl, {
    record: true,
    timeout: 30,
    machineDetection: "enable",
    callbackUrl: webhookUrl,
  });

  const callId = randomUUID();
  const vobizCallId = callResult.callId;

  // 7. Store call record
  await db.insert(schema.calls).values({
    id: callId,
    leadId,
    clientId: tenantId,
    vobizCallId,
    attemptNumber,
    startedAt: new Date(),
    pitchUsed: systemInstruction.slice(0, 500),
  });

  // 8. Trigger greeting (outbound call — AI speaks first)
  setTimeout(() => {
    if (!geminiSession.isClosed) {
      geminiSession.triggerGreeting();
    }
  }, 2000);

  // 9. Poll call status and bridge audio
  // In production, Vobiz would stream audio via WebSocket to Gemini.
  // For now we poll status until call ends.
  try {
    await pollCallUntilEnded(vobizCallId, geminiSession, (status) => {
      if (status === "completed" || status === "failed") {
        callEnded = true;
      }
    });
  } catch {
    // fallback timeout
    callEnded = true;
  }

  durationMs = Date.now() - callStartedAt;
  geminiSession.close();

  // 11. Determine outcome and extract intelligence
  const statusResult = await vobizClient.getCallStatus(vobizCallId);
  outcome = determineOutcome(statusResult.status, transcript);

  const durationSec = Math.round(durationMs / 1000);
  const recordingResult = await vobizClient.getCallRecording(vobizCallId).catch(() => null);
  const summary = generateTranscriptSummary(transcript, companyProfile.companyName);
  const nextSteps = extractNextSteps(transcript, outcome);
  const sentiment = analyzeSentiment(transcript);

  // 12. Update call record with final data
  await db
    .update(schema.calls)
    .set({
      outcome: outcome as any,
      durationSec,
      transcript: transcript as any,
      summary,
      sentiment,
      recordingUrl: recordingResult?.recordingUrl ?? null,
      endedAt: new Date(),
    })
    .where(eq(schema.calls.id, callId));

  // 13. Update client lead status
  await db
    .update(schema.clientLeads)
    .set({
      status: mapOutcomeToLeadStatus(outcome),
      lastCallAt: new Date(),
    })
    .where(
      and(
        eq(schema.clientLeads.leadId, leadId),
        eq(schema.clientLeads.clientId, tenantId),
      ),
    );

  // 14. Enqueue outcome processing
  await queue.enqueue("call-outcome", {
    leadId,
    clientId: tenantId,
    callId,
    outcome,
    summary,
    nextSteps,
    sentiment,
  }, {
    priority: "normal",
    tenantId,
    correlationId: callId,
  });

  return {
    callId,
    vobizCallId,
    outcome,
    transcript,
    summary,
    nextSteps,
    sentiment,
    durationSec,
  };
}

function mapOutcomeToLeadStatus(outcome: string): typeof schema.clientLeads.status.enumValues[number] {
  switch (outcome) {
    case "interested": return "qualified";
    case "booked": return "booked";
    case "not_interested": return "parked";
    case "completed": return "contacted";
    case "no_answer": return "contacted";
    default: return "contacted";
  }
}

function determineOutcome(
  vobizStatus: string,
  transcript: TranscriptTurn[],
): string {
  if (vobizStatus === "failed" || vobizStatus === "busy") return "failed";
  if (vobizStatus === "no_answer") return "no_answer";

  if (transcript.length === 0) return vobizStatus;

  const userMessages = transcript.filter((t) => t.role === "user");
  const agentMessages = transcript.filter((t) => t.role === "assistant");

  if (userMessages.length === 0) return "picked_no_response";

  const lastUserMsg = userMessages[userMessages.length - 1]?.text?.toLowerCase() ?? "";
  const allUserText = userMessages.map((t) => t.text).join(" ").toLowerCase();

  // Strong negative signals
  if (
    lastUserMsg.includes("not interested") ||
    lastUserMsg.includes("no thank") ||
    lastUserMsg.includes("don't call") ||
    lastUserMsg.includes("remove me") ||
    lastUserMsg.includes("do not disturb")
  ) {
    return "not_interested";
  }

  // Booking signals
  if (
    allUserText.includes("book") ||
    allUserText.includes("schedule") ||
    allUserText.includes("visit") ||
    allUserText.includes("demo") ||
    allUserText.includes("meeting") ||
    (lastUserMsg.includes("yes") && (allUserText.includes("saturday") || allUserText.includes("sunday")))
  ) {
    return "booked";
  }

  // Positive interest signals
  if (
    lastUserMsg.includes("yes") ||
    lastUserMsg.includes("sure") ||
    lastUserMsg.includes("interested") ||
    lastUserMsg.includes("tell me more")
  ) {
    return "interested";
  }

  return "completed";
}

function analyzeSentiment(transcript: TranscriptTurn[]): string {
  const userMessages = transcript.filter((t) => t.role === "user");
  if (userMessages.length === 0) return "neutral";

  const positiveSignals = ["great", "good", "yes", "sure", "interested", "love", "excellent", "perfect", "amazing", "thank"];
  const negativeSignals = ["no", "not interested", "busy", "stop", "don't call", "hate", "bad", "worst", "annoying"];

  let positiveCount = 0;
  let negativeCount = 0;

  for (const msg of userMessages) {
    const lower = msg.text.toLowerCase();
    for (const signal of positiveSignals) {
      if (lower.includes(signal)) positiveCount++;
    }
    for (const signal of negativeSignals) {
      if (lower.includes(signal)) negativeCount++;
    }
  }

  if (positiveCount > negativeCount + 2) return "positive";
  if (negativeCount > positiveCount + 2) return "negative";
  return "neutral";
}

function generateTranscriptSummary(transcript: TranscriptTurn[], companyName: string): string {
  if (transcript.length === 0) return "No conversation recorded — call was not answered or had no audio.";

  const userMessages = transcript.filter((t) => t.role === "user");
  const agentMessages = transcript.filter((t) => t.role === "assistant");

  const turns = transcript.slice(0, 30).map(
    (t) => `${t.role === "user" ? "Customer" : "Agent"}: ${t.text}`,
  );

  const header = `[${companyName}] Call Summary (${userMessages.length} customer turns, ${agentMessages.length} agent turns)`;
  const body = turns.join("\n");

  return `${header}\n\n${body}`;
}

function extractNextSteps(transcript: TranscriptTurn[], outcome: string): string {
  if (outcome === "no_answer" || outcome === "failed") {
    return "Retry call. No conversation occurred.";
  }
  if (outcome === "not_interested") {
    return "Lead explicitly declined. Do not call again. Park lead.";
  }
  if (outcome === "booked") {
    const userMessages = transcript.filter((t) => t.role === "user");
    const lastMessages = userMessages.slice(-5).map((t) => t.text).join(" ").toLowerCase();
    const nextSteps: string[] = ["Meeting/site visit scheduled."];
    if (lastMessages.includes("saturday") || lastMessages.includes("sunday")) {
      nextSteps.push("Confirm day and time via WhatsApp/SMS.");
    }
    nextSteps.push("Send reminder 24 hours before.");
    return nextSteps.join(" ");
  }
  if (outcome === "interested") {
    return "Lead showed interest. Follow up within 24 hours with additional details and proposed meeting time.";
  }
  return "Call completed. Review transcript for follow-up actions.";
}

/**
 * Polls Vobiz call status until the call ends (completed/failed/no_answer/busy).
 */
async function pollCallUntilEnded(
  vobizCallId: string,
  _geminiSession: GeminiLiveSession,
  onStatusChange: (status: string) => void,
  maxPolls = 120,
  pollIntervalMs = 2000,
): Promise<void> {
  const vobizClient = getVobizClient();
  for (let i = 0; i < maxPolls; i++) {
    try {
      const status = await vobizClient.getCallStatus(vobizCallId);
      onStatusChange(status.status);
      if (["completed", "failed", "no_answer", "busy"].includes(status.status)) {
        return;
      }
    } catch {
      // continue polling
    }
    await sleep(pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
