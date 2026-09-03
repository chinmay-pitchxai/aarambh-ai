import { NextRequest, NextResponse } from "next/server";
import { db } from "@/backend/db";
import { handleGmailWebhook } from "@/backend/messaging/gmail";

// ── Gmail Webhook ──
// Handles both:
// 1. Real Google PubSub push notifications (message.data with base64-encoded historyId)
// 2. Legacy payloads (leadId, clientId, subject, body)

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Detect PubSub format vs legacy
  const payload = body as Record<string, unknown>;
  const isPubSub =
    payload.message && typeof payload.message === "object" &&
    typeof (payload.message as Record<string, unknown>).data === "string";

  const isDecodedMessage =
    typeof payload.messageId === "string" ||
    (typeof payload.from === "string" && typeof payload.body === "string");

  if (isPubSub || isDecodedMessage) {
    // Real Gmail webhook — full conversational AI pipeline
    try {
      const result = await handleGmailWebhook(db, body);
      return NextResponse.json({ received: true, ...result });
    } catch (err) {
      console.error("[api/webhooks/gmail] webhook error:", err);
      return NextResponse.json({ received: true });
    }
  }

  // Legacy format: { leadId, clientId, subject, body, timestamp }
  const { leadId, clientId, subject, body: emailBody, timestamp } = payload as {
    leadId?: string;
    clientId?: string;
    subject?: string;
    body?: string;
    timestamp?: string;
  };

  if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }
  if (!clientId || typeof clientId !== "string" || clientId.trim().length === 0) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  if (!subject || typeof subject !== "string" || subject.trim().length === 0) {
    return NextResponse.json({ error: "subject required" }, { status: 400 });
  }
  if (!emailBody || typeof emailBody !== "string" || emailBody.trim().length === 0) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  try {
    const { processInboundGmail } = await import("@/backend/agents/inbound-handler");
    const result = await processInboundGmail({
      leadId,
      clientId,
      subject,
      body: emailBody,
      timestamp: timestamp ? new Date(timestamp) : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/webhooks/gmail] legacy error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
