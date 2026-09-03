import { NextRequest, NextResponse } from "next/server";
import { db } from "@/backend/db";
import { handleWhatsAppWebhook } from "@/backend/messaging/whatsapp";

// ── WhatsApp Webhook ──
// Handles both:
// 1. Real Meta WhatsApp Cloud API webhooks (object: "whatsapp_business_account")
// 2. Legacy payloads (leadId, clientId, messageBody)

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Detect Meta webhook format vs legacy
  const payload = body as Record<string, unknown>;
  const isMetaWebhook =
    payload.object === "whatsapp_business_account" ||
    (Array.isArray(payload.entry) && payload.entry.length > 0);

  if (isMetaWebhook) {
    // Real Meta WhatsApp webhook — full conversational AI pipeline
    try {
      const result = await handleWhatsAppWebhook(db, body);
      return NextResponse.json({ received: true, ...result });
    } catch (err) {
      console.error("[api/webhooks/whatsapp] Meta webhook error:", err);
      return NextResponse.json({ received: true });
    }
  }

  // Legacy format: { leadId, clientId, messageBody, timestamp }
  const { leadId, clientId, messageBody, timestamp } = payload as {
    leadId?: string;
    clientId?: string;
    messageBody?: string;
    timestamp?: string;
  };

  if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }
  if (!clientId || typeof clientId !== "string" || clientId.trim().length === 0) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  if (!messageBody || typeof messageBody !== "string" || messageBody.trim().length === 0) {
    return NextResponse.json({ error: "messageBody required" }, { status: 400 });
  }

  try {
    const { processInboundWhatsApp } = await import("@/backend/agents/inbound-handler");
    const result = await processInboundWhatsApp({
      leadId,
      clientId,
      body: messageBody,
      timestamp: timestamp ? new Date(timestamp) : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/webhooks/whatsapp] legacy error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
