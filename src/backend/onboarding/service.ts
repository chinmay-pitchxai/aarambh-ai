import { Command } from "@langchain/langgraph";
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as schema from "@/backend/db/schema";
import { appendOutboxEvent } from "@/backend/events/outbox";
import { autoOnboard, type AutoOnboardResult } from "@/backend/services/auto-onboard";
import { autoSetupAfterOnboarding, type AutoSetupResult } from "@/backend/services/auto-setup";
import {
  companyOnboardingInputSchema,
  createCompanyOnboardingGraph,
  createCorrelationId,
  graphInvocationConfig,
  onboardingEventSchema,
  type CompanyOnboardingInput,
  type CompanyOnboardingStateType,
  type CompanyProfileDraft,
  type OnboardingStatus,
  type SpecialistFinding,
} from "@/backend/langgraph/onboarding";

export type Database = PostgresJsDatabase<typeof schema>;
export type OnboardingGraph = ReturnType<typeof createCompanyOnboardingGraph>;

export interface OnboardingRuntime {
  graph: OnboardingGraph;
}

export interface OnboardingContext {
  tenantId: string;
  actorId: string;
}

export interface OnboardingStartResult {
  runId: string;
  threadId: string;
  status: OnboardingStatus;
  companyId: string;
}

const toUrl = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}, z.string().url().max(500));

export const onboardingSubmitSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  website: toUrl,
  description: z.string().trim().max(2_000).optional(),
  location: z.string().trim().min(2).max(1_000).optional(),
});
export type OnboardingSubmitInput = z.infer<typeof onboardingSubmitSchema>;

export const onboardingEditsSchema = z.object({
  companyName: z.string().trim().min(2).max(160).optional(),
  website: toUrl.optional(),
  location: z.string().trim().min(2).max(1_000).optional(),
  description: z.string().trim().max(2_000).optional(),
  category: z.string().trim().max(300).optional(),
  industry: z.string().trim().max(300).optional(),
  claims: z.record(z.string(), z.array(z.string())).optional(),
});
export type OnboardingEdits = z.infer<typeof onboardingEditsSchema>;

export class OnboardingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "ONBOARDING_ERROR") {
    super(message);
    this.name = "OnboardingError";
    this.status = status;
    this.code = code;
  }
}

let defaultRuntimePromise: Promise<OnboardingRuntime> | null = null;

/**
 * Lazily builds the shared, checkpointer-backed onboarding graph. Postgres
 * checkpointing makes threads durable across requests so a run can be resumed
 * with a confirmation Command at any time.
 */
export async function getDefaultOnboardingRuntime(): Promise<OnboardingRuntime> {
  if (!defaultRuntimePromise) {
    defaultRuntimePromise = (async () => {
      const [{ serverConfig }, { createPostgresCheckpointer }] = await Promise.all([
        import("@/backend/config"),
        import("@/backend/langgraph/checkpointer"),
      ]);
      const checkpointSchema = process.env.LANGGRAPH_CHECKPOINT_SCHEMA?.trim() || "public";
      const checkpointer = await createPostgresCheckpointer({
        connectionString: serverConfig.databaseUrl,
        schema: checkpointSchema,
        runSetup: true,
      });
      return { graph: createCompanyOnboardingGraph({ checkpointer }) };
    })().catch((error) => {
      defaultRuntimePromise = null;
      throw error;
    });
  }
  return defaultRuntimePromise;
}

function buildGraphInput(params: {
  runId: string;
  threadId: string;
  tenantId: string;
  actorId: string;
  companyId: string;
  input: OnboardingSubmitInput;
  now: Date;
}): CompanyOnboardingInput {
  return companyOnboardingInputSchema.parse({
    schemaVersion: 1,
    runId: params.runId,
    threadId: params.threadId,
    tenantId: params.tenantId,
    actorId: params.actorId,
    correlationId: createCorrelationId(),
    causationId: null,
    inputEventId: `input_${randomUUID()}`,
    companyId: params.companyId,
    companyProfileVersion: 1,
    configSnapshotId: "default-onboarding-config",
    policySnapshotId: "default-onboarding-policy",
    companyName: params.input.companyName,
    website: params.input.website,
    location: params.input.location ?? "Unknown",
    suppliedEvidence: [{ uri: params.input.website, label: "Company website" }],
    createdAt: params.now.toISOString(),
  });
}

function mapGraphStatusToRunStatus(status: OnboardingStatus): "pending" | "running" | "completed" | "failed" {
  if (status === "confirmed" || status === "rejected") return "completed";
  return "running";
}

function serializeState(state: CompanyOnboardingStateType) {
  return {
    currentStatus: state.currentStatus,
    specialistFindings: state.specialistFindings,
    profileDraft: state.profileDraft,
    decision: state.decision,
    checkpointSeq: state.checkpointSeq,
    updatedAt: state.updatedAt,
  };
}

function readRunMetadata(run: typeof schema.graphRuns.$inferSelect): Record<string, unknown> {
  return run.metadata && typeof run.metadata === "object" ? (run.metadata as Record<string, unknown>) : {};
}

function readRunOutput(run: typeof schema.graphRuns.$inferSelect): {
  currentStatus?: OnboardingStatus;
  profileDraft?: CompanyProfileDraft;
  specialistFindings?: SpecialistFinding[];
  decision?: CompanyOnboardingStateType["decision"];
} {
  if (!run.output || typeof run.output !== "object") return {};
  return run.output as {
    currentStatus?: OnboardingStatus;
    profileDraft?: CompanyProfileDraft;
    specialistFindings?: SpecialistFinding[];
    decision?: CompanyOnboardingStateType["decision"];
  };
}

async function readLiveState(graph: OnboardingGraph, threadId: string): Promise<CompanyOnboardingStateType | null> {
  try {
    const snapshot = await graph.getState(graphInvocationConfig(threadId));
    if (!snapshot) return null;
    return snapshot.values as CompanyOnboardingStateType;
  } catch {
    return null;
  }
}

async function requireRun(
  db: Database,
  tenantId: string,
  threadId: string,
): Promise<typeof schema.graphRuns.$inferSelect> {
  const [run] = await db
    .select()
    .from(schema.graphRuns)
    .where(and(eq(schema.graphRuns.id, threadId), eq(schema.graphRuns.tenantId, tenantId)))
    .limit(1);
  if (!run) throw new OnboardingError("Onboarding run not found", 404, "RUN_NOT_FOUND");
  return run;
}

async function getProfileForOrg(
  db: Database,
  tenantId: string,
): Promise<typeof schema.businessProfiles.$inferSelect | null> {
  const [profile] = await db
    .select()
    .from(schema.businessProfiles)
    .where(eq(schema.businessProfiles.organizationId, tenantId))
    .limit(1);
  return profile ?? null;
}

async function markRunFailed(db: Database, runId: string, error: unknown): Promise<void> {
  await db
    .update(schema.graphRuns)
    .set({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.graphRuns.id, runId))
    .catch(() => {});
}

async function persistDraftResearch(
  db: Database,
  tenantId: string,
  draft: CompanyProfileDraft,
  findings: SpecialistFinding[],
  now: Date,
): Promise<void> {
  await db
    .update(schema.businessProfiles)
    .set({
      companyName: draft.companyName,
      website: draft.website,
      location: draft.location,
      researchStatus: "partial",
      profileData: {
        claims: draft.claims,
        sourceUris: draft.sourceUris,
        gaps: draft.gaps,
        warnings: draft.warnings,
        confidence: draft.confidence,
        specialistFindings: findings,
      },
      researchSources: draft.sourceUris,
      confidenceScore: Math.round(draft.confidence * 100),
      lastResearchedAt: now,
      rawResearchData: { specialistFindings: findings },
      updatedAt: now,
    })
    .where(eq(schema.businessProfiles.organizationId, tenantId));
}

/**
 * Validates input, upserts the company profile record, and invokes the
 * onboarding graph. The graph runs the five specialists, synthesizes a draft,
 * and pauses for human confirmation at the confirmation interrupt.
 */
export async function startOnboarding(
  db: Database,
  ctx: OnboardingContext,
  input: OnboardingSubmitInput,
  runtime?: OnboardingRuntime,
): Promise<OnboardingStartResult> {
  const activeRuntime = runtime ?? (await getDefaultOnboardingRuntime());
  const parsed = onboardingSubmitSchema.parse(input);
  const now = new Date();
  const threadId = randomUUID();
  const runId = threadId;

  const existingProfile = await getProfileForOrg(db, ctx.tenantId);
  const companyId = existingProfile?.id ?? randomUUID();

  const graphInput = buildGraphInput({
    runId,
    threadId,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    companyId,
    input: parsed,
    now,
  });

  await db.insert(schema.graphRuns).values({
    id: runId,
    tenantId: ctx.tenantId,
    graphName: "company_onboarding",
    threadId,
    input: graphInput,
    status: "running",
    startedAt: now,
    metadata: {
      threadId,
      companyId,
      actorId: ctx.actorId,
      correlationId: graphInput.correlationId,
      inputEventId: graphInput.inputEventId,
    },
  });

  await db
    .insert(schema.businessProfiles)
    .values({
      id: companyId,
      organizationId: ctx.tenantId,
      companyName: parsed.companyName,
      website: parsed.website,
      location: parsed.location ?? "Unknown",
      description: parsed.description,
      researchStatus: "researching",
      profileData: { companyName: parsed.companyName, website: parsed.website, description: parsed.description ?? null },
      lastResearchedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.businessProfiles.organizationId,
      set: {
        companyName: parsed.companyName,
        website: parsed.website,
        location: parsed.location ?? "Unknown",
        description: parsed.description,
        researchStatus: "researching",
        profileData: { companyName: parsed.companyName, website: parsed.website, description: parsed.description ?? null },
        lastResearchedAt: now,
        updatedAt: now,
      },
    });

  let state: CompanyOnboardingStateType;
  try {
    state = await activeRuntime.graph.invoke({ input: graphInput }, graphInvocationConfig(threadId));
  } catch (error) {
    await markRunFailed(db, runId, error);
    throw error;
  }

  const status = state.currentStatus;
  const runPatch: Partial<typeof schema.graphRuns.$inferInsert> = {
    status: mapGraphStatusToRunStatus(status),
    output: serializeState(state),
    updatedAt: now,
  };
  if (status === "confirmed" || status === "rejected") runPatch.endedAt = now;
  await db.update(schema.graphRuns).set(runPatch).where(eq(schema.graphRuns.id, runId));

  if (state.profileDraft) {
    await persistDraftResearch(db, ctx.tenantId, state.profileDraft, state.specialistFindings, now);
  }

  return { runId, threadId, status, companyId };
}

export interface OnboardingRunStatus {
  runId: string;
  threadId: string;
  status: OnboardingStatus;
  runStatus: string;
  error: string | null;
  startedAt: Date;
  endedAt: Date | null;
  specialistFindings: SpecialistFinding[];
  profileDraft: CompanyProfileDraft | null;
  decision: CompanyOnboardingStateType["decision"];
  checkpointSeq: number;
}

/**
 * Returns the graph run's persisted status plus the live graph state so callers
 * can watch specialist findings progress while the graph is paused.
 */
export async function getRunStatus(
  db: Database,
  ctx: OnboardingContext,
  threadId: string,
  runtime?: OnboardingRuntime,
): Promise<OnboardingRunStatus> {
  const activeRuntime = runtime ?? (await getDefaultOnboardingRuntime());
  const run = await requireRun(db, ctx.tenantId, threadId);
  const live = await readLiveState(activeRuntime.graph, threadId);
  const output = readRunOutput(run);

  return {
    runId: run.id,
    threadId,
    status: live?.currentStatus ?? output.currentStatus ?? "submitted",
    runStatus: run.status ?? "",
    error: run.error ?? null,
    startedAt: run.startedAt ?? new Date(),
    endedAt: run.endedAt ?? null,
    specialistFindings: live?.specialistFindings ?? output.specialistFindings ?? [],
    profileDraft: live?.profileDraft ?? output.profileDraft ?? null,
    decision: live?.decision ?? output.decision ?? null,
    checkpointSeq: live?.checkpointSeq ?? 0,
  };
}

export interface OnboardingDraftResult {
  runId: string;
  threadId: string;
  researchStatus: string;
  profile: {
    companyName: string | null;
    website: string | null;
    location: string | null;
    description: string | null;
    category: string | null;
    industry: string | null;
    claims: Record<string, string[]>;
    sourceUris: string[];
    gaps: string[];
    warnings: string[];
    confidence: number;
    lastResearchedAt: Date | null;
  };
}

/** Returns the current draft company profile from the business profile record. */
export async function getDraft(
  db: Database,
  ctx: OnboardingContext,
  threadId: string,
  runtime?: OnboardingRuntime,
): Promise<OnboardingDraftResult> {
  const activeRuntime = runtime ?? (await getDefaultOnboardingRuntime());
  const run = await requireRun(db, ctx.tenantId, threadId);
  const profile = await getProfileForOrg(db, ctx.tenantId);
  const live = await readLiveState(activeRuntime.graph, threadId);
  const output = readRunOutput(run);

  const draft = live?.profileDraft ?? output.profileDraft;
  const profileData = profile?.profileData && typeof profile.profileData === "object"
    ? (profile.profileData as Record<string, unknown>)
    : {};

  return {
    runId: run.id,
    threadId,
    researchStatus: profile?.researchStatus ?? "pending",
    profile: {
      companyName: profile?.companyName ?? draft?.companyName ?? null,
      website: profile?.website ?? draft?.website ?? null,
      location: profile?.location ?? draft?.location ?? null,
      description: profile?.description ?? null,
      category: profile?.category ?? null,
      industry: profile?.industry ?? null,
      claims: (profileData.claims as Record<string, string[]> | undefined) ?? draft?.claims ?? {},
      sourceUris: (profileData.sourceUris as string[] | undefined) ?? draft?.sourceUris ?? [],
      gaps: (profileData.gaps as string[] | undefined) ?? draft?.gaps ?? [],
      warnings: (profileData.warnings as string[] | undefined) ?? draft?.warnings ?? [],
      confidence: typeof profileData.confidence === "number" ? profileData.confidence : draft?.confidence ?? 0,
      lastResearchedAt: profile?.lastResearchedAt ?? null,
    },
  };
}

/** Persists partial draft edits on the company profile record. */
export async function editDraft(
  db: Database,
  ctx: OnboardingContext,
  threadId: string,
  edits: OnboardingEdits,
  runtime?: OnboardingRuntime,
): Promise<OnboardingDraftResult> {
  const activeRuntime = runtime ?? (await getDefaultOnboardingRuntime());
  await requireRun(db, ctx.tenantId, threadId);
  const parsed = onboardingEditsSchema.parse(edits);
  const profile = await getProfileForOrg(db, ctx.tenantId);
  if (!profile) throw new OnboardingError("Draft profile not found", 404, "DRAFT_NOT_FOUND");

  const profileData = profile.profileData && typeof profile.profileData === "object"
    ? (profile.profileData as Record<string, unknown>)
    : {};

  const patch: Partial<typeof schema.businessProfiles.$inferInsert> = {
    updatedAt: new Date(),
    profileData: { ...profileData, editedAt: new Date().toISOString() },
  };
  if (parsed.companyName !== undefined) patch.companyName = parsed.companyName;
  if (parsed.website !== undefined) patch.website = parsed.website;
  if (parsed.location !== undefined) patch.location = parsed.location;
  if (parsed.description !== undefined) patch.description = parsed.description;
  if (parsed.category !== undefined) patch.category = parsed.category;
  if (parsed.industry !== undefined) patch.industry = parsed.industry;
  if (parsed.claims !== undefined) {
    const existingClaims = typeof profileData.claims === "object" && profileData.claims
      ? (profileData.claims as Record<string, string[]>)
      : {};
    patch.profileData = {
      ...profileData,
      claims: { ...existingClaims, ...parsed.claims },
      editedAt: new Date().toISOString(),
    };
  }

  await db.update(schema.businessProfiles).set(patch).where(eq(schema.businessProfiles.organizationId, ctx.tenantId));

  return getDraft(db, ctx, threadId, activeRuntime);
}

export interface OnboardingConfirmResult {
  runId: string;
  threadId: string;
  status: OnboardingStatus;
  decision: CompanyOnboardingStateType["decision"];
  profile: CompanyProfileDraft;
  autoSetup: AutoSetupResult | null;
}

/**
 * Resumes the graph with an approval confirmation, persists the confirmed
 * profile to business_profiles, and emits a company.profile_confirmed event
 * through the transactional outbox.
 */
export async function confirmProfile(
  db: Database,
  ctx: OnboardingContext,
  threadId: string,
  runtime?: OnboardingRuntime,
): Promise<OnboardingConfirmResult> {
  const activeRuntime = runtime ?? (await getDefaultOnboardingRuntime());
  const run = await requireRun(db, ctx.tenantId, threadId);
  const now = new Date();

  let state: CompanyOnboardingStateType;
  try {
    state = await activeRuntime.graph.invoke(
      new Command({ resume: { action: "approve" } }),
      graphInvocationConfig(threadId),
    );
  } catch (error) {
    await markRunFailed(db, run.id, error);
    throw error;
  }

  const draft = state.profileDraft;
  if (!draft) throw new OnboardingError("Profile draft is unavailable; cannot confirm", 409, "DRAFT_MISSING");

  const profile = await getProfileForOrg(db, ctx.tenantId);
  const profileData = profile?.profileData && typeof profile.profileData === "object"
    ? (profile.profileData as Record<string, unknown>)
    : {};

  const profilePatch: Partial<typeof schema.businessProfiles.$inferInsert> = {
    companyName: draft.companyName,
    website: draft.website,
    location: draft.location,
    profileData: {
      ...profileData,
      claims: draft.claims,
      sourceUris: draft.sourceUris,
      gaps: draft.gaps,
      warnings: draft.warnings,
      confidence: draft.confidence,
      specialistFindings: state.specialistFindings,
      confirmedAt: now.toISOString(),
    },
    researchStatus: "completed",
    researchSources: draft.sourceUris,
    confidenceScore: Math.round(draft.confidence * 100),
    lastResearchedAt: now,
    rawResearchData: { specialistFindings: state.specialistFindings, decision: state.decision },
    updatedAt: now,
  };
  if (profile?.description !== undefined && profile.description !== null) {
    profilePatch.description = profile.description;
  }

  await db.update(schema.businessProfiles).set(profilePatch).where(eq(schema.businessProfiles.organizationId, ctx.tenantId));

  await db
    .update(schema.graphRuns)
    .set({
      status: "completed",
      output: serializeState(state),
      endedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.graphRuns.id, run.id));

  const metadata = readRunMetadata(run);
  const companyId = typeof metadata.companyId === "string" ? metadata.companyId : profile?.id ?? "";
  const event = onboardingEventSchema.parse({
    kind: "company.profile_confirmed",
    companyId,
    timestamp: now.toISOString(),
    payload: { runId: run.id, threadId, actorId: ctx.actorId, profileDraft: draft },
  });
  await appendOutboxEvent({
    tenantId: ctx.tenantId,
    eventType: event.kind,
    aggregateType: "company_profile",
    aggregateId: event.companyId,
    payload: event,
  });

  // Auto-setup: generate sales prompts, build RAG, generate ICP
  let autoSetupResult: AutoSetupResult | null = null;
  try {
    autoSetupResult = await autoSetupAfterOnboarding(db, ctx.tenantId, {
      companyName: draft.companyName,
      website: draft.website,
      industry: profile?.industry ?? "General",
      description: profile?.description ?? "",
      location: draft.location,
      products: Array.isArray(profileData.products) ? profileData.products as string[] : undefined,
      targetMarket: typeof profileData.targetMarket === "string" ? profileData.targetMarket : undefined,
    });
    console.log(`[onboarding] Auto-setup completed for ${draft.companyName}: RAG=${autoSetupResult.ragBuilt}, Prompts=${autoSetupResult.promptsGenerated}, ICP=${autoSetupResult.icpGenerated}`);
  } catch (err) {
    console.warn("[onboarding] Auto-setup failed (non-blocking):", err);
  }

  return { runId: run.id, threadId, status: state.currentStatus, decision: state.decision, profile: draft, autoSetup: autoSetupResult };
}

// ── Simplified auto-onboarding (one-shot: research → ICP → sample leads) ──

export interface AutoOnboardStartResult {
  companyProfile: {
    companyName: string;
    website: string;
    description: string;
    industry: string;
    products: string[];
    services: string[];
    targetMarket: string;
    confidenceScore: number;
  };
  icp: {
    target_industries: string[];
    target_titles: string[];
    target_seniorities: string[];
    target_company_sizes: string[];
    target_locations: string[];
    keywords: string[];
  };
  sampleLeads: {
    totalSearched: number;
    totalFound: number;
    totalNew: number;
    totalDuplicate: number;
    leadIds: string[];
  };
  leadSearch: {
    totalSearched: number;
    totalFound: number;
    totalNew: number;
    totalDuplicate: number;
    leadIds: string[];
  };
}

/**
 * Simplified onboarding: takes company name + website, runs full pipeline
 * (research → ICP → Apollo lead search → 3 sample leads), stores everything,
 * and returns results for confirmation.
 */
export async function autoOnboardCompany(
  db: Database,
  ctx: OnboardingContext,
  input: OnboardingSubmitInput,
): Promise<AutoOnboardStartResult> {
  const parsed = onboardingSubmitSchema.parse(input);

  const result = await autoOnboard(db, {
    tenantId: ctx.tenantId,
    companyName: parsed.companyName,
    website: parsed.website,
    location: parsed.location,
  });

  return {
    companyProfile: {
      companyName: result.companyProfile.companyName,
      website: result.companyProfile.website,
      description: result.companyProfile.description,
      industry: result.companyProfile.industry,
      products: result.companyProfile.products,
      services: result.companyProfile.services,
      targetMarket: result.companyProfile.targetMarket,
      confidenceScore: result.companyProfile.confidenceScore,
    },
    icp: {
      target_industries: result.icp.target_industries,
      target_titles: result.icp.target_titles,
      target_seniorities: result.icp.target_seniorities,
      target_company_sizes: result.icp.target_company_sizes,
      target_locations: result.icp.target_locations,
      keywords: result.icp.keywords,
    },
    sampleLeads: result.sampleLeads,
    leadSearch: result.leadSearch,
  };
}

export interface OnboardingRunListItem {
  runId: string;
  threadId: string;
  runStatus: string;
  graphStatus: OnboardingStatus | null;
  error: string | null;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

/** Lists the tenant's onboarding runs from the graph_runs table. */
export async function listOnboardingRuns(
  db: Database,
  ctx: OnboardingContext,
  options?: { limit?: number; offset?: number },
): Promise<OnboardingRunListItem[]> {
  const limit = Math.min(100, Math.max(1, options?.limit ?? 50));
  const offset = Math.max(0, options?.offset ?? 0);
  const rows = await db
    .select()
    .from(schema.graphRuns)
    .where(and(eq(schema.graphRuns.tenantId, ctx.tenantId), eq(schema.graphRuns.graphName, "company_onboarding")))
    .orderBy(desc(schema.graphRuns.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((run) => ({
    runId: run.id,
    threadId: run.id,
    runStatus: run.status ?? "",
    graphStatus: readRunOutput(run).currentStatus ?? null,
    error: run.error ?? null,
    startedAt: run.startedAt ?? new Date(),
    endedAt: run.endedAt ?? null,
    createdAt: run.createdAt ?? new Date(),
    metadata: readRunMetadata(run),
  }));
}