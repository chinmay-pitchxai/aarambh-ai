import { randomUUID } from "crypto";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { getVobizClient } from "../../integrations/vobiz";
import { serverConfig } from "../../config";
import type { DurableQueue, Job } from "../durable-queue";
import { initiateVoiceCall } from "../../voice/voice-agent";

// ── Call Worker ──
// Processes call-init jobs from the durable queue.
// When voice agent is enabled, uses Gemini Live + Vobiz for AI-powered calls.
// Falls back to basic Vobiz call placement if voice agent is unavailable.

interface CallJobPayload {
  tenantId: string;
  leadId: string;
  clientId: string;
  fromNumber: string;
  toNumber: string;
  attemptNumber: number;
}

export async function handleCallJob(
  db: any,
  queue: DurableQueue,
  job: Job<CallJobPayload>,
): Promise<{ callId: string; vobizCallId: string; voiceEnabled: boolean }> {
  const { tenantId, leadId, clientId, fromNumber, toNumber, attemptNumber } = job.payload;

  // Check if Gemini API key is available for voice agent
  const voiceEnabled = !!serverConfig.geminiApiKey;

  if (voiceEnabled) {
    // ── Voice Agent Path: Gemini Live + Vobiz ──
    const result = await initiateVoiceCall(queue, {
      tenantId,
      leadId,
      fromNumber,
      attemptNumber,
    });

    return {
      callId: result.callId,
      vobizCallId: result.vobizCallId,
      voiceEnabled: true,
    };
  }

  // ── Fallback Path: Basic Vobiz call placement ──
  const client = getVobizClient();
  const webhookUrl = `${serverConfig.appUrl}/api/v1/webhooks/vobiz`;

  const result = await client.initiateCall(fromNumber, toNumber, webhookUrl, {
    record: true,
    timeout: 30,
    machineDetection: "enable",
    callbackUrl: webhookUrl,
  });

  const callId = randomUUID();

  await db.insert(schema.calls).values({
    id: callId,
    leadId,
    clientId,
    vobizCallId: result.callId,
    attemptNumber,
    startedAt: new Date(),
  });

  return { callId, vobizCallId: result.callId, voiceEnabled: false };
}
