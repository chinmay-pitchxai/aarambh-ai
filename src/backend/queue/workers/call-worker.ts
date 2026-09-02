import { randomUUID } from "crypto";
import { db, schema } from "../../db";
import { eq } from "drizzle-orm";
import { getVobizClient } from "../../integrations/vobiz";
import { serverConfig } from "../../config";
import type { DurableQueue, Job } from "../durable-queue";

// ── Call Worker ──
// Processes call-init jobs from the durable queue.
// Uses Vobiz client to place outbound calls, records them in the calls table.

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
): Promise<{ callId: string; vobizCallId: string }> {
  const { tenantId, leadId, clientId, fromNumber, toNumber, attemptNumber } = job.payload;

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

  return { callId, vobizCallId: result.callId };
}
