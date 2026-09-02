import { z } from "zod";

export const SPECIALIST_IDS = [
  "business_website_research",
  "lead_market_intelligence",
  "outreach_strategy",
  "conversation_objection_strategy",
  "meeting_qualification_scheduling",
] as const;

export const specialistIdSchema = z.enum(SPECIALIST_IDS);
export type SpecialistId = z.infer<typeof specialistIdSchema>;

export const sourceReferenceSchema = z.object({
  uri: z.string().trim().min(1),
  label: z.string().trim().min(1),
  capturedAt: z.string().datetime().optional(),
});

export const specialistClaimSchema = z.object({
  field: z.string().trim().min(1),
  value: z.string().trim().min(1),
  sourceUris: z.array(z.string().trim().min(1)).max(25),
});

export const specialistFindingSchema = z.object({
  specialistId: specialistIdSchema,
  claims: z.array(specialistClaimSchema).max(50),
  sources: z.array(sourceReferenceSchema).max(50),
  confidence: z.number().min(0).max(1),
  gaps: z.array(z.string().trim().min(1)).max(25),
  warnings: z.array(z.string().trim().min(1)).max(25),
});
export type SpecialistFinding = z.infer<typeof specialistFindingSchema>;

export const proposedActionSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(["fetch_leads", "send_message", "book_call", "send_email", "manual_review"]),
  target: z.string().trim().min(1),
  payload: z.record(z.unknown()).default({}),
  status: z.enum(["pending", "approved", "rejected", "executed"]).default("pending"),
});
export type ProposedAction = z.infer<typeof proposedActionSchema>;

export const toolReceiptSchema = z.object({
  toolName: z.string().trim().min(1),
  executedAt: z.string().datetime(),
  inputHash: z.string().trim().min(1),
  outputHash: z.string().trim().min(1),
  costPaise: z.number().int().nonnegative().default(0),
});
export type ToolReceipt = z.infer<typeof toolReceiptSchema>;

export const pendingJobSchema = z.object({
  jobId: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  scheduledAt: z.string().datetime(),
  status: z.enum(["queued", "running", "completed", "failed"]).default("queued"),
});
export type PendingJob = z.infer<typeof pendingJobSchema>;

export const policyGateResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().trim().min(1).optional(),
  violations: z.array(z.string().trim().min(1)).default([]),
});
export type PolicyGateResult = z.infer<typeof policyGateResultSchema>;

export const onboardingEventSchema = z.object({
  kind: z.enum(["company.profile_confirmed", "company.profile_rejected", "company.profile_edited", "onboarding.completed", "onboarding.failed"]),
  companyId: z.string().trim().min(1),
  timestamp: z.string().datetime(),
  payload: z.record(z.unknown()).default({}),
});
export type OnboardingEvent = z.infer<typeof onboardingEventSchema>;

export const companyOnboardingInputSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  threadId: z.string().trim().min(1).max(255),
  tenantId: z.string().trim().min(1),
  actorId: z.string().trim().min(1),
  correlationId: z.string().trim().min(1),
  causationId: z.string().trim().min(1).nullable(),
  inputEventId: z.string().trim().min(1),
  companyId: z.string().trim().min(1),
  companyProfileVersion: z.number().int().positive(),
  configSnapshotId: z.string().trim().min(1),
  policySnapshotId: z.string().trim().min(1),
  companyName: z.string().trim().min(2).max(160),
  website: z.string().url().max(500),
  location: z.string().trim().min(2).max(1_000),
  suppliedEvidence: z.array(sourceReferenceSchema).max(50).default([]),
  createdAt: z.string().datetime(),
});
export type CompanyOnboardingInput = z.infer<typeof companyOnboardingInputSchema>;

export type OnboardingInput = z.infer<typeof companyOnboardingInputSchema>;

export const graphRuntimeEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  graphName: z.literal("company_onboarding"),
  runId: z.string().uuid(),
  threadId: z.string().min(1).max(255),
  tenantId: z.string().min(1),
  actorId: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().nullable(),
  inputEventId: z.string().min(1),
  companyId: z.string().min(1),
  companyProfileVersion: z.number().int().positive(),
  campaignId: z.string().nullable(),
  leadId: z.string().nullable(),
  conversationId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  configSnapshotId: z.string().min(1),
  policySnapshotId: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type GraphRuntimeEnvelope = z.infer<typeof graphRuntimeEnvelopeSchema>;

export function createCorrelationId(): string {
  return `corr_${Date.now().toString(36)}_${crypto.randomUUID()}`;
}

export function createRunId(): string {
  return crypto.randomUUID();
}

export const companyProfileDraftSchema = z.object({
  companyName: z.string(),
  website: z.string().url(),
  location: z.string(),
  claims: z.record(z.string(), z.array(z.string())),
  sourceUris: z.array(z.string()),
  gaps: z.array(z.string()),
  warnings: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});
export type CompanyProfileDraft = z.infer<typeof companyProfileDraftSchema>;

export const confirmationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(1).max(1_000) }),
  z.object({ action: z.literal("edit"), profile: companyProfileDraftSchema }),
]);
export type CompanyProfileConfirmation = z.infer<typeof confirmationSchema>;

export const specialistResultInputSchema = z.object({
  specialistId: specialistIdSchema,
  input: companyOnboardingInputSchema,
  evidenceLimit: z.number().int().positive().default(25),
});
export type SpecialistResultInput = z.infer<typeof specialistResultInputSchema>;

export const specialistOutputSchema = specialistFindingSchema;
export type SpecialistOutput = SpecialistFinding;

export const policyGateInputSchema = z.object({
  specialistFindings: z.array(specialistFindingSchema),
  profileDraft: companyProfileDraftSchema,
  proposedActions: z.array(proposedActionSchema),
});
export type PolicyGateInput = z.infer<typeof policyGateInputSchema>;
