import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession } from "@/backend/auth";
import { db, schema } from "@/backend/db";
import { researchBusiness } from "@/backend/services/business-research";
import { searchApolloProspects, type ApolloProspect, type IcpProfile } from "@/backend/services/apollo";
import { autoSetupAfterOnboarding } from "@/backend/services/auto-setup";
import Redis from "ioredis";
import { createDurableQueue } from "@/backend/queue/durable-queue";
import { initiateCall } from "@/backend/telephony/call-engine";

const onboardingInput = z.object({
  companyName: z.string().trim().min(2, "Business name is required").max(160),
  businessType: z.string().trim().min(2, "Business type is required").max(160),
  website: z.string().trim().max(500).optional().default(""),
  mapLocation: z.string().trim().max(1000).optional().default(""),
}).refine((value) => value.website.length > 0 || value.mapLocation.length > 0, {
  message: "Add a website or a location so we can research your business.",
  path: ["website"],
});

function prospectScore(prospect: ApolloProspect, icp: IcpProfile) {
  let score = 55;
  const title = (prospect.title || "").toLowerCase();
  if (icp.personTitles.some((candidate) => title.includes(candidate.toLowerCase()))) score += 20;
  if (/owner|founder|chief|ceo|vp|vice president|head|director/.test(title)) score += 12;
  if (prospect.email) score += 5;
  if (prospect.phone) score += 5;
  if (prospect.city && icp.locations.some((location) => location.toLowerCase().includes(prospect.city!.toLowerCase()))) score += 3;
  return Math.min(98, score);
}

async function saveProspect(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], organizationId: string, prospect: ApolloProspect, icp: IcpProfile) {
  const [existing] = await tx.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.sourceRef, prospect.id)).limit(1);
  const leadId = existing?.id || randomUUID();
  if (!existing) {
    await tx.insert(schema.leads).values({
      id: leadId,
      phoneE164: prospect.phone,
      email: prospect.email,
      firstName: prospect.firstName,
      lastName: prospect.lastName,
      company: prospect.company,
      title: prospect.title,
      city: prospect.city,
      industry: prospect.industry,
      companySize: prospect.companySize,
      sourceRef: prospect.id,
      sourceCost: 0,
      rawData: prospect.raw,
      icpTags: [...icp.industries, ...icp.personTitles, ...icp.locations].slice(0, 20),
      freshness: new Date(),
    });
  }
  const score = prospectScore(prospect, icp);
  await tx.insert(schema.clientLeads).values({
    id: randomUUID(),
    clientId: organizationId,
    leadId,
    score,
    band: score >= 80 ? "hot" : score >= 60 ? "warm" : "cold",
    status: "new",
  }).onConflictDoNothing({ target: [schema.clientLeads.clientId, schema.clientLeads.leadId] });
  return leadId;
}

async function queueInitialCalls(organizationId: string, leadIds: string[]): Promise<{ queued: number; warning: string | null }> {
  if (leadIds.length === 0) return { queued: 0, warning: null };
  if (!process.env.VOBIZ_AUTH_ID || !process.env.VOBIZ_FROM_NUMBER) {
    return { queued: 0, warning: "Leads were saved, but calls are waiting for Vobiz to be connected." };
  }

  const [number] = await db
    .select({ numberE164: schema.phoneNumbers.numberE164 })
    .from(schema.phoneNumbers)
    .where(and(eq(schema.phoneNumbers.tenantId, organizationId), eq(schema.phoneNumbers.status, "assigned")))
    .limit(1);
  if (!number) return { queued: 0, warning: "Leads were saved, but no Vobiz number is assigned to this workspace yet." };

  const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", { lazyConnect: true, connectTimeout: 2_000, maxRetriesPerRequest: 1 });
  try {
    const queue = createDurableQueue(redis, "call-init");
    let queued = 0;
    for (const leadId of leadIds) {
      const result = await initiateCall(db, queue, { tenantId: organizationId, leadId, fromNumber: number.numberE164 });
      if (result.success) queued++;
    }
    return { queued, warning: queued === 0 ? "Leads were saved; calls will start during the permitted calling window when phone-ready prospects are available." : null };
  } catch (error) {
    console.error("[onboarding] call queue failed", error);
    return { queued: 0, warning: "Leads were saved, but the call queue is temporarily unavailable." };
  } finally {
    redis.disconnect();
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const parsed = onboardingInput.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid business details" }, { status: 400 });

    const research = await researchBusiness(parsed.data);
    let prospects: ApolloProspect[] = [];
    let leadDiscoveryWarning: string | null = null;
    try {
      prospects = await searchApolloProspects(research.icp, 20);
    } catch (error) {
      leadDiscoveryWarning = error instanceof Error ? error.message : "Apollo lead discovery is temporarily unavailable";
      console.warn("[onboarding] Apollo lead discovery failed", error);
    }

    const importedLeadIds = await db.transaction(async (tx) => {
      await tx.insert(schema.businessProfiles).values({
        id: randomUUID(),
        organizationId: session.activeOrganizationId,
        companyName: research.companyName,
        location: research.location,
        category: research.category,
        description: research.description,
        website: research.website,
        industry: research.industry,
        profileData: { icp: research.icp, organization: research.organization, websiteMetadata: research.websiteMetadata },
        researchStatus: leadDiscoveryWarning ? "partial" : "completed",
        researchSources: research.sources,
        confidenceScore: research.confidenceScore,
        lastResearchedAt: new Date(),
        rawResearchData: { organization: research.organization },
      }).onConflictDoUpdate({
        target: schema.businessProfiles.organizationId,
        set: {
          companyName: research.companyName,
          location: research.location,
          category: research.category,
          description: research.description,
          website: research.website,
          industry: research.industry,
          profileData: { icp: research.icp, organization: research.organization, websiteMetadata: research.websiteMetadata },
          researchStatus: leadDiscoveryWarning ? "partial" : "completed",
          researchSources: research.sources,
          confidenceScore: research.confidenceScore,
          lastResearchedAt: new Date(),
          rawResearchData: { organization: research.organization },
          updatedAt: new Date(),
        },
      });
      const ids: string[] = [];
      for (const prospect of prospects) ids.push(await saveProspect(tx, session.activeOrganizationId, prospect, research.icp));
      await tx.update(schema.organizations).set({ name: research.companyName, onboardingCompletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.organizations.id, session.activeOrganizationId));
      return ids;
    });

    const callLaunch = await queueInitialCalls(session.activeOrganizationId, importedLeadIds);

    // Auto-setup: generate sales prompts + build RAG after onboarding
    let autoSetupResult = null;
    try {
      autoSetupResult = await autoSetupAfterOnboarding(db, session.activeOrganizationId, {
        companyName: research.companyName,
        website: research.website,
        industry: research.industry,
        description: research.description,
        location: research.location,
      });
    } catch (err) {
      console.warn("[onboarding] Auto-setup failed (non-blocking):", err);
    }

    return NextResponse.json({
      success: true,
      business: { companyName: research.companyName, industry: research.industry, description: research.description, location: research.location },
      icp: research.icp,
      leadsImported: importedLeadIds.length,
      autoSetup: autoSetupResult ? {
        ragBuilt: autoSetupResult.ragBuilt,
        ragChunks: autoSetupResult.ragChunks,
        promptsGenerated: autoSetupResult.promptsGenerated,
        icpGenerated: autoSetupResult.icpGenerated,
      } : null,
      callsQueued: callLaunch.queued,
      warning: [leadDiscoveryWarning, callLaunch.warning].filter(Boolean).join(" ") || null,
    });
  } catch (error) {
    console.error("[onboarding]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Onboarding failed" }, { status: 500 });
  }
}
