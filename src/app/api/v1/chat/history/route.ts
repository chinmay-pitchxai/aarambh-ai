import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { chatMessages } from "@/backend/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));

  try {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.tenantId, auth.ctx.tenantId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);

    const messages = rows.reverse().map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    }));

    return NextResponse.json({ messages });
  } catch (err) {
    console.error("[api/v1/chat/history] GET error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
