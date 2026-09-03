import { Annotation, END, interrupt, Send, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import {
  companyOnboardingInputSchema,
  companyProfileDraftSchema,
  confirmationSchema,
  graphRuntimeEnvelopeSchema,
  specialistFindingSchema,
  type CompanyOnboardingInput,
  type CompanyProfileConfirmation,
  type CompanyProfileDraft,
  type GraphRuntimeEnvelope,
  type SpecialistFinding,
  type SpecialistId,
} from "./contracts";
import {
  DEFAULT_SPECIALIST_RUNTIME_CONFIG,
  evidenceOnlySpecialistExecutor,
  validateSpecialistConfig,
  type SpecialistDefinition,
  type SpecialistExecutor,
  type SpecialistRuntimeConfig,
} from "./specialists";

export type OnboardingStatus = "submitted" | "researching" | "awaiting_confirmation" | "confirmed" | "rejected";

function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function findingReducer(current: SpecialistFinding[], update: SpecialistFinding[]): SpecialistFinding[] {
  const byId = new Map(current.map((finding) => [finding.specialistId, finding]));
  for (const candidate of update) byId.set(candidate.specialistId, specialistFindingSchema.parse(candidate));
  return [...byId.values()].sort((a, b) => a.specialistId.localeCompare(b.specialistId));
}

export const CompanyOnboardingState = Annotation.Root({
  input: Annotation<CompanyOnboardingInput>(),
  runtime: Annotation<GraphRuntimeEnvelope>(),
  currentStatus: Annotation<OnboardingStatus>({ reducer: (_left, right) => right, default: () => "submitted" }),
  specialistTask: Annotation<SpecialistDefinition | null>({ reducer: (_left, right) => right, default: () => null }),
  specialistFindings: Annotation<SpecialistFinding[]>({ reducer: findingReducer, default: () => [] }),
  decision: Annotation<CompanyProfileConfirmation | null>({ reducer: (_left, right) => right, default: () => null }),
  profileDraft: Annotation<CompanyProfileDraft | null>({ reducer: (_left, right) => right, default: () => null }),
  proposedActions: Annotation<string[]>({ reducer: (_left, right) => stableUnique(right), default: () => [] }),
  approvedActionIds: Annotation<string[]>({ reducer: (_left, right) => stableUnique(right), default: () => [] }),
  toolReceipts: Annotation<string[]>({ reducer: (_left, right) => stableUnique(right), default: () => [] }),
  pendingJobs: Annotation<string[]>({ reducer: (_left, right) => stableUnique(right), default: () => [] }),
  errors: Annotation<string[]>({ reducer: (left, right) => stableUnique([...left, ...right]), default: () => [] }),
  checkpointSeq: Annotation<number>({ reducer: (left, right) => Math.max(left, right), default: () => 0 }),
  updatedAt: Annotation<string>({ reducer: (_left, right) => right, default: () => new Date(0).toISOString() }),
});
export type CompanyOnboardingStateType = typeof CompanyOnboardingState.State;

export interface CompanyOnboardingGraphOptions {
  checkpointer: BaseCheckpointSaver;
  specialists?: SpecialistRuntimeConfig;
  executor?: SpecialistExecutor;
  now?: () => Date;
}

function synthesize(input: CompanyOnboardingInput, findings: SpecialistFinding[]): CompanyProfileDraft {
  const claimGroups: Record<string, string[]> = {};
  for (const finding of findings) {
    for (const claim of finding.claims) claimGroups[claim.field] = stableUnique([...(claimGroups[claim.field] ?? []), claim.value]);
  }
  const confidence = findings.length === 0 ? 0 : findings.reduce((sum, finding) => sum + finding.confidence, 0) / findings.length;
  return companyProfileDraftSchema.parse({
    companyName: input.companyName,
    website: input.website,
    location: input.location,
    claims: Object.fromEntries(Object.entries(claimGroups).sort(([a], [b]) => a.localeCompare(b))),
    sourceUris: stableUnique(findings.flatMap((finding) => finding.sources.map(({ uri }) => uri))),
    gaps: stableUnique(findings.flatMap(({ gaps }) => gaps)),
    warnings: stableUnique([
      ...findings.flatMap(({ warnings }) => warnings),
      ...Object.entries(claimGroups).filter(([, values]) => values.length > 1).map(([field]) => `Conflicting values require review: ${field}`),
    ]),
    confidence,
  });
}

export function createCompanyOnboardingGraph(options: CompanyOnboardingGraphOptions) {
  const specialists = validateSpecialistConfig(options.specialists ?? DEFAULT_SPECIALIST_RUNTIME_CONFIG);
  const executor = options.executor ?? evidenceOnlySpecialistExecutor;
  const now = options.now ?? (() => new Date());

  const validateInput = async (state: CompanyOnboardingStateType) => ({
    input: companyOnboardingInputSchema.parse(state.input),
    runtime: graphRuntimeEnvelopeSchema.parse({
      schemaVersion: state.input.schemaVersion,
      graphName: "company_onboarding",
      runId: state.input.runId,
      threadId: state.input.threadId,
      tenantId: state.input.tenantId,
      actorId: state.input.actorId,
      correlationId: state.input.correlationId,
      causationId: state.input.causationId,
      inputEventId: state.input.inputEventId,
      companyId: state.input.companyId,
      companyProfileVersion: state.input.companyProfileVersion,
      campaignId: null,
      leadId: null,
      conversationId: null,
      subscriptionId: null,
      configSnapshotId: state.input.configSnapshotId,
      policySnapshotId: state.input.policySnapshotId,
      createdAt: state.input.createdAt,
    }),
    currentStatus: "researching" as const,
    checkpointSeq: state.checkpointSeq + 1,
    updatedAt: now().toISOString(),
  });

  const dispatchSpecialists = (state: CompanyOnboardingStateType) => specialists.definitions.map(
    (specialist) => new Send("run_specialist", { ...state, specialistTask: specialist }),
  );

  const runSpecialist = async (state: CompanyOnboardingStateType) => {
    if (!state.specialistTask) throw new Error("Specialist task was not supplied");
    const finding = specialistFindingSchema.parse(await executor.execute(state.specialistTask, state.input));
    if (finding.specialistId !== state.specialistTask.id) throw new Error(`Specialist returned mismatched id: ${finding.specialistId}`);
    return { specialistFindings: [finding], updatedAt: now().toISOString() };
  };

  const synthesizeProfile = async (state: CompanyOnboardingStateType) => ({
    profileDraft: synthesize(state.input, state.specialistFindings),
    currentStatus: "awaiting_confirmation" as const,
    checkpointSeq: state.checkpointSeq + 1,
    updatedAt: now().toISOString(),
  });

  const confirmProfile = async (state: CompanyOnboardingStateType) => {
    if (!state.profileDraft) throw new Error("Profile draft is unavailable");
    const decision = confirmationSchema.parse(interrupt({
      kind: "company_profile_confirmation",
      runId: state.input.runId,
      companyId: state.input.companyId,
      profile: state.profileDraft,
    }));
    return {
      decision,
      profileDraft: decision.action === "edit" ? decision.profile : state.profileDraft,
      currentStatus: decision.action === "reject" ? "rejected" as const : "confirmed" as const,
      checkpointSeq: state.checkpointSeq + 1,
      updatedAt: now().toISOString(),
    };
  };

  return new StateGraph(CompanyOnboardingState)
    .addNode("validate_input", validateInput)
    .addNode("run_specialist", runSpecialist)
    .addNode("synthesize_profile", synthesizeProfile)
    .addNode("confirm_profile", confirmProfile)
    .addEdge(START, "validate_input")
    .addConditionalEdges("validate_input", dispatchSpecialists, ["run_specialist"])
    .addEdge("run_specialist", "synthesize_profile")
    .addEdge("synthesize_profile", "confirm_profile")
    .addEdge("confirm_profile", END)
    .compile({ checkpointer: options.checkpointer });
}

export function graphInvocationConfig(threadId: string) {
  if (!threadId.trim() || threadId.length > 255) throw new Error("threadId must contain 1-255 characters");
  return { configurable: { thread_id: threadId } } as const;
}

export type { SpecialistId };
