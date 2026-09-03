import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { autoOnboard, type AutoOnboardResult } from "@/backend/services/auto-onboard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { tenantId } = auth.ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { companyName, website, location } = body as {
    companyName?: string;
    website?: string;
    location?: string;
  };

  if (!companyName || typeof companyName !== "string" || companyName.trim().length < 2) {
    return NextResponse.json({ error: "companyName is required (min 2 chars)" }, { status: 400 });
  }

  if (!website || typeof website !== "string" || website.trim().length < 3) {
    return NextResponse.json({ error: "website is required" }, { status: 400 });
  }

  try {
    const result: AutoOnboardResult = await autoOnboard(db, {
      tenantId,
      companyName: companyName.trim(),
      website: website.trim(),
      location: location?.trim(),
    });

    return NextResponse.json({
      success: true,
      companyProfile: {
        name: result.companyProfile.companyName,
        industry: result.companyProfile.industry,
        description: result.companyProfile.description,
        confidence: result.companyProfile.confidenceScore,
      },
      icp: {
        industries: result.icp.target_industries,
        titles: result.icp.target_titles,
        locations: result.icp.target_locations,
      },
      leads: {
        total: result.leads.totalNew,
        duplicate: result.leads.totalDuplicate,
        sampleLeads: result.sampleLeadDetails,
      },
      ragBuilt: result.ragBuilt,
      promptsGenerated: result.promptsGenerated,
    });
  } catch (err) {
    console.error("[api/v1/auto-onboard] POST error", err);
    const msg = err instanceof Error ? err.message : "Auto-onboard failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
