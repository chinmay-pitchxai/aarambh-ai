import { NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { confirmProfile, OnboardingError } from "@/backend/onboarding/service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { threadId: string } }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const result = await confirmProfile(
      db,
      { tenantId: auth.ctx.tenantId, actorId: auth.ctx.userId },
      params.threadId,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OnboardingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[api/v1/onboarding/confirm]", error);
    return NextResponse.json({ error: "Failed to confirm company profile" }, { status: 500 });
  }
}