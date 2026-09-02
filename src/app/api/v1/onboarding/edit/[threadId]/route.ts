import { NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { editDraft, OnboardingError, onboardingEditsSchema } from "@/backend/onboarding/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { threadId: string } }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = onboardingEditsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid draft edits" },
      { status: 400 },
    );
  }

  try {
    const result = await editDraft(
      db,
      { tenantId: auth.ctx.tenantId, actorId: auth.ctx.userId },
      params.threadId,
      parsed.data,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OnboardingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[api/v1/onboarding/edit]", error);
    return NextResponse.json({ error: "Failed to update onboarding draft" }, { status: 500 });
  }
}