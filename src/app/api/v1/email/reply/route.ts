import { NextRequest, NextResponse } from "next/server";
import { db } from "@/backend/db";
import { getSession } from "@/backend/auth";
import { replyToThread, sendManualReply } from "@/backend/messaging/email-agent";

// POST /api/v1/email/reply — Reply to a Gmail thread. When `body` is provided
// the reply is sent verbatim; otherwise the email-agent auto-generates a
// human-like reply from the conversation.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const tenantId = session.activeOrganizationId;

  let payload: { threadId?: string; body?: string };
  try {
    payload = (await req.json()) as { threadId?: string; body?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const threadId = typeof payload?.threadId === "string" ? payload.threadId.trim() : "";
  if (!threadId) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 });
  }

  try {
    if (typeof payload.body === "string" && payload.body.trim().length > 0) {
      const result = await sendManualReply(db, tenantId, threadId, payload.body.trim());
      if (!result || !result.replied) {
        return NextResponse.json({ replied: false, error: "Unable to reply to thread" }, { status: 422 });
      }
      return NextResponse.json({ replied: true, threadId, intent: result.intent });
    }

    const result = await replyToThread(db, tenantId, threadId);
    if (!result) {
      return NextResponse.json({ replied: false, error: "Unable to reply to thread" }, { status: 422 });
    }
    return NextResponse.json({
      replied: result.replied,
      threadId,
      intent: result.intent,
      reply: result.reply,
    });
  } catch (err) {
    console.error("[api/v1/email/reply] POST error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}