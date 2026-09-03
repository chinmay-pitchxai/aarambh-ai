import { NextRequest, NextResponse } from "next/server";
import { db } from "@/backend/db";
import { requireAuth } from "@/backend/auth/middleware";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "@/backend/services/notifications";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));

  try {
    const [notifications, total, unreadCount] = await Promise.all([
      getNotifications(db, auth.ctx.tenantId, auth.ctx.userId, { limit, offset }),
      getNotifications(db, auth.ctx.tenantId, auth.ctx.userId, { limit: 1, offset: 0 }),
      getUnreadCount(db, auth.ctx.tenantId, auth.ctx.userId),
    ]);

    return NextResponse.json({
      notifications: notifications.notifications,
      total: total.total,
      unreadCount,
    });
  } catch (err) {
    console.error("[api/v1/notifications] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, notificationId } = body as {
    action?: string;
    notificationId?: string;
  };

  try {
    if (action === "mark_all_read") {
      const count = await markAllAsRead(db, auth.ctx.tenantId, auth.ctx.userId);
      return NextResponse.json({ marked: count });
    }

    if (action === "mark_read" && notificationId) {
      await markAsRead(db, notificationId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action. Use 'mark_read' with notificationId or 'mark_all_read'." }, { status: 400 });
  } catch (err) {
    console.error("[api/v1/notifications] PATCH error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
