import { NextRequest, NextResponse } from "next/server";
import { processInboundGmail } from "@/backend/agents/inbound-handler";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { leadId, clientId, subject, body: emailBody, timestamp } = body as {
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
    const result = await processInboundGmail({
      leadId,
      clientId,
      subject,
      body: emailBody,
      timestamp: timestamp ? new Date(timestamp) : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/webhooks/gmail] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
