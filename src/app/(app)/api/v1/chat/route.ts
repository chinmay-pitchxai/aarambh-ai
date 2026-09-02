import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { chatMessages } from "@/backend/db/schema";
import { eq, desc } from "drizzle-orm";
import { askDashboardAssistant } from "@/backend/agents/dashboard-assistant";

export const dynamic = "force-dynamic";

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

function checkRateLimit(tenantId: string): boolean {
  const now = Date.now();
  const entry = RATE_LIMIT.get(tenantId);
  if (!entry || now > entry.resetAt) {
    RATE_LIMIT.set(tenantId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { tenantId, userId } = auth.ctx;

  if (!checkRateLimit(tenantId)) {
    return NextResponse.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const userMessage = body.message.trim();
  if (userMessage.length === 0 || userMessage.length > 2000) {
    return NextResponse.json({ error: "Message must be 1-2000 characters" }, { status: 400 });
  }

  try {
    // Fetch recent chat history for context
    const historyRows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.tenantId, tenantId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(10);

    const chatHistory = historyRows.reverse().map((r) => ({
      role: r.role,
      content: r.content,
    }));

    // Save user message
    await db.insert(chatMessages).values({
      tenantId,
      userId,
      role: "user",
      content: userMessage,
    });

    // Get assistant response
    const result = await askDashboardAssistant(userMessage, tenantId, chatHistory);

    // Save assistant message
    await db.insert(chatMessages).values({
      tenantId,
      userId,
      role: "assistant",
      content: result.response,
      metadata: result.data ? JSON.stringify(result.data) : null,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[api/chat] error", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
