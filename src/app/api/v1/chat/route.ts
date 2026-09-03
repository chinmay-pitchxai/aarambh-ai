import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { chatMessages } from "@/backend/db/schema";
import { eq, desc } from "drizzle-orm";
import { askDashboardAssistant } from "@/backend/agents/dashboard-assistant";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message } = body as { message?: string };
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Persist user message
  try {
    await db.insert(chatMessages).values({
      tenantId: auth.ctx.tenantId,
      userId: auth.ctx.userId,
      role: "user",
      content: message.trim(),
    });
  } catch (err) {
    console.error("[api/v1/chat] failed to persist user message", err);
  }

  // Fetch recent chat history for context
  const historyRows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.tenantId, auth.ctx.tenantId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(20);

  const chatHistory = historyRows
    .reverse()
    .map((row) => ({ role: row.role, content: row.content }));

  // Call dashboard assistant
  try {
    const result = await askDashboardAssistant(
      message.trim(),
      auth.ctx.tenantId,
      chatHistory,
    );

    // Persist assistant response
    try {
      await db.insert(chatMessages).values({
        tenantId: auth.ctx.tenantId,
        userId: auth.ctx.userId,
        role: "assistant",
        content: result.response,
        metadata: result.data ? { toolData: result.data, action: result.action } : null,
      });
    } catch (err) {
      console.error("[api/v1/chat] failed to persist assistant message", err);
    }

    return NextResponse.json({
      response: result.response,
      action: result.action,
    });
  } catch (err) {
    console.error("[api/v1/chat] assistant error", err);
    const msg = err instanceof Error ? err.message : "Assistant unavailable";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
