import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/backend/db";
import { verifyVobizSignature } from "@/backend/webhooks/signature";
import { serverConfig } from "@/backend/config";
import { handleCallEvent } from "@/backend/telephony/call-engine";
import { randomUUID } from "crypto";

// ── Vobiz Webhook (v1) ──
// Verifies HMAC-SHA256 signature, persists raw event, processes via call engine.
// Returns 200 immediately after persisting.

interface WebhookPayload {
  event_type?: string;
  call_id?: string;
  callId?: string;
  CallUUID?: string;
  vobiz_call_id?: string;
  [key: string]: unknown;
}

export async function POST(request: Request) {
  const secret = serverConfig.webhooks.vobizSecret;
  if (!secret && serverConfig.isProduction) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  let rawBody: string;
  let payload: WebhookPayload;
  try {
    rawBody = await request.text();
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (secret) {
    const signature =
      request.headers.get("x-vobiz-signature") ||
      request.headers.get("x-webhook-signature");

    if (!verifyVobizSignature(secret, rawBody, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const eventType =
    (payload.event_type as string) ||
    (payload.CallStatus as string) ||
    (payload.call_status as string) ||
    "unknown";
  // Vobiz posts call UUIDs under several names depending on callback type
  // (answer_url, hangup_url / status_callback).
  const rawCallId =
    payload.call_id ||
    payload.callId ||
    payload.CallUUID ||
    payload.CallUuid ||
    payload.call_uuid ||
    payload.request_uuid ||
    payload.vobiz_call_id;
  const idempotencyKey = payload.idempotency_key as string | undefined;

  if (idempotencyKey) {
    const [existing] = await db
      .select()
      .from(schema.callEvents)
      .where(eq(schema.callEvents.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existing) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  await db.insert(schema.webhookEvents).values({
    id: randomUUID(),
    source: "vobiz",
    eventType,
    headers: {
      "content-type": request.headers.get("content-type"),
      "x-vobiz-signature": request.headers.get("x-vobiz-signature"),
    },
    payload,
    status: "received",
  });

  if (rawCallId) {
    const eventInsertIdempotencyKey = idempotencyKey || `evt_${rawCallId}_${eventType}_${Date.now()}`;
    try {
      await db.insert(schema.callEvents).values({
        id: randomUUID(),
        callId: String(rawCallId),
        eventType,
        payloadJson: payload,
        idempotencyKey: eventInsertIdempotencyKey,
      });
    } catch {
      // Duplicate idempotency key — another worker already persisted this event
    }
  }

  try {
    await handleCallEvent(db, {} as any, {
      vobizCallId: rawCallId ? String(rawCallId) : undefined,
      eventType,
      payload: payload as Record<string, unknown>,
      idempotencyKey,
    });
  } catch (err) {
    console.error("[v1/webhooks/vobiz] handleCallEvent error:", err);
  }

  return NextResponse.json({ received: true });
}
