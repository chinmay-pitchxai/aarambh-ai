import { NextRequest, NextResponse } from "next/server";
import { processInboundWhatsApp } from "@/backend/agents/inbound-handler";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { leadId, clientId, messageBody, timestamp } = body as {
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
    const result = await processInboundWhatsApp({
      leadId,
      clientId,
      body: messageBody,
      timestamp: timestamp ? new Date(timestamp) : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/webhooks/whatsapp] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
