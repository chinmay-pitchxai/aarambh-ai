import { NextResponse } from "next/server";
import { db } from "@/backend/db";
import { getSession } from "@/backend/auth";
import { pollAndReply } from "@/backend/messaging/email-agent";

// POST /api/v1/email/poll — Trigger the Gmail AI agent to scan unread threads
// for the session tenant and reply conversationally where intent warrants it.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const tenantId = session.activeOrganizationId;

  try {
    const { replied, scanned } = await pollAndReply(db, tenantId, { query: "is:unread" });
    return NextResponse.json({ replied, scanned });
  } catch (err) {
    console.error("[api/v1/email/poll] POST error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}