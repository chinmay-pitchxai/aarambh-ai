import { NextResponse } from "next/server";
import { db } from "@/backend/db";
import { requireAuth } from "@/backend/auth/middleware";
import { getUnreadCount } from "@/backend/services/notifications";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const unreadCount = await getUnreadCount(db, auth.ctx.tenantId, auth.ctx.userId);
    return NextResponse.json({ unreadCount });
  } catch (err) {
    console.error("[api/v1/notifications/unread] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
