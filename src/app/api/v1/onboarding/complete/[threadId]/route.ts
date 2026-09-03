import { NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { confirmProfile, OnboardingError } from "@/backend/onboarding/service";
import { generateICP } from "@/backend/services/icp-generation";
import { generateSampleLeads } from "@/backend/services/sample-leads";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { threadId: string } }) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const confirmResult = await confirmProfile(
      db,
      { tenantId: auth.ctx.tenantId, actorId: auth.ctx.userId },
      params.threadId,
    );

    const profile = confirmResult.profile;

    let icp = null;
    try {
      icp = await generateICP(db, auth.ctx.tenantId, {
        companyName: profile.companyName,
        industry: "Business services",
        location: profile.location,
        description: "",
        website: profile.website,
      });
    } catch (error) {
      console.warn("[onboarding/complete] ICP generation failed", error);
    }

    let sampleLeadIds: string[] = [];
    try {
      sampleLeadIds = await generateSampleLeads(db, auth.ctx.tenantId, {
        companyName: profile.companyName,
        industry: null,
        location: profile.location,
        category: null,
        website: profile.website,
      });
    } catch (error) {
      console.warn("[onboarding/complete] sample lead generation failed", error);
    }

    return NextResponse.json({
      status: confirmResult.status,
      runId: confirmResult.runId,
      threadId: confirmResult.threadId,
      profile: confirmResult.profile,
      icp,
      sampleLeadCount: sampleLeadIds.length,
      sampleLeadIds,
    });
  } catch (error) {
    if (error instanceof OnboardingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[api/v1/onboarding/complete]", error);
    return NextResponse.json({ error: "Failed to complete onboarding" }, { status: 500 });
  }
}
