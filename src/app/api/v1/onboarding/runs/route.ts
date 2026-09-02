import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { listOnboardingRuns, OnboardingError } from "@/backend/onboarding/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
  const rawOffset = parseInt(searchParams.get("offset") ?? "0", 10);
  const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
  const offset = Number.isFinite(rawOffset) ? rawOffset : 0;

  try {
    const runs = await listOnboardingRuns(
      db,
      { tenantId: auth.ctx.tenantId, actorId: auth.ctx.userId },
      { limit, offset },
    );
    return NextResponse.json({ runs, total: runs.length, limit, offset });
  } catch (error) {
    if (error instanceof OnboardingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[api/v1/onboarding/runs]", error);
    return NextResponse.json({ error: "Failed to load onboarding runs" }, { status: 500 });
  }
}