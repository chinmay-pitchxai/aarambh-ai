import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/backend/db";
import Redis from "ioredis";
import { createDurableQueue } from "@/backend/queue/durable-queue";
import { handleCallEvent } from "@/backend/telephony/call-engine";

function authorized(request: Request) {
  const expected = process.env.VOBIZ_WEBHOOK_SECRET;
  if (!expected) return process.env.NODE_ENV !== "production";
  const received = request.headers.get("x-webhook-secret") || request.headers.get("x-vobiz-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeTranscript(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.map((turn: any) => ({
    role: String(turn.role || turn.speaker || turn.participant || "prospect").toLowerCase(),
    text: String(turn.text || turn.transcript || turn.utterance || "").trim(),
  })).filter((turn) => turn.text);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  try {
    const payload = await request.json();
    const callId = payload.call_id || payload.callId || payload.CallUUID || payload.vobiz_call_id;
    if (!callId) return NextResponse.json({ error: "Missing call id" }, { status: 400 });
    const transcript = normalizeTranscript(payload.transcript || payload.segments || payload.conversation);
    const recordingUrl = payload.recording_url || payload.recordingUrl || payload.url || null;
    const changes: Partial<typeof schema.calls.$inferInsert> = {};
    if (recordingUrl) changes.recordingUrl = recordingUrl;
    if (transcript) changes.transcript = transcript;
    if (typeof payload.summary === "string") changes.summary = payload.summary;
    if (typeof payload.duration === "number") changes.durationSec = Math.round(payload.duration);
    if (typeof payload.duration_sec === "number") changes.durationSec = Math.round(payload.duration_sec);
    if (payload.ended_at) changes.endedAt = new Date(payload.ended_at);
    if (Object.keys(changes).length > 0) await db.update(schema.calls).set(changes).where(eq(schema.calls.vobizCallId, String(callId)));

    // A completed telephony callback is the hand-off to retries, WhatsApp
    // follow-ups, or booking. Persisting it alone leaves the lead stranded.
    const eventType = typeof payload.event_type === "string"
      ? payload.event_type
      : typeof payload.status === "string" && ["no_answer", "busy", "failed"].includes(payload.status)
        ? "call.failed"
        : "call.completed";
    const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1,
    });
    try {
      await handleCallEvent(db, createDurableQueue(redis, "call-outcome"), {
        vobizCallId: String(callId),
        eventType,
        payload: payload as Record<string, unknown>,
      });
    } finally {
      redis.disconnect();
    }
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[webhooks/vobiz]", error);
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }
}
