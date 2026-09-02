import type { CompanyOnboardingInput, SpecialistFinding, SpecialistId } from "./contracts";
import { SPECIALIST_IDS, specialistFindingSchema } from "./contracts";

export interface SpecialistDefinition {
  id: SpecialistId;
  displayName: string;
  objective: string;
}

export interface SpecialistRuntimeConfig {
  definitions: readonly SpecialistDefinition[];
  maxClaimsPerSpecialist: number;
  maxSourcesPerSpecialist: number;
}

export interface SpecialistExecutor {
  execute(definition: SpecialistDefinition, input: CompanyOnboardingInput): Promise<SpecialistFinding>;
}

const DEFINITION_BY_ID: Record<SpecialistId, Omit<SpecialistDefinition, "id">> = {
  business_website_research: { displayName: "Business and website research", objective: "Establish evidence-backed company facts." },
  lead_market_intelligence: { displayName: "Lead and market intelligence", objective: "Identify ICP and market hypotheses from supplied evidence." },
  outreach_strategy: { displayName: "Outreach strategy", objective: "Propose evidence-backed positioning and channel constraints." },
  conversation_objection_strategy: { displayName: "Conversation and objection strategy", objective: "Identify conversation themes, gaps, and objections." },
  meeting_qualification_scheduling: { displayName: "Meeting qualification and scheduling", objective: "Define qualification and scheduling information requirements." },
};

export const DEFAULT_SPECIALIST_RUNTIME_CONFIG: SpecialistRuntimeConfig = Object.freeze({
  definitions: Object.freeze(SPECIALIST_IDS.map((id) => Object.freeze({ id, ...DEFINITION_BY_ID[id] }))),
  maxClaimsPerSpecialist: 50,
  maxSourcesPerSpecialist: 50,
});

export function validateSpecialistConfig(config: SpecialistRuntimeConfig): SpecialistRuntimeConfig {
  const ids = config.definitions.map(({ id }) => id);
  if (ids.length !== SPECIALIST_IDS.length || new Set(ids).size !== SPECIALIST_IDS.length || SPECIALIST_IDS.some((id) => !ids.includes(id))) {
    throw new Error(`Company onboarding requires exactly these five specialists: ${SPECIALIST_IDS.join(", ")}`);
  }
  if (!Number.isInteger(config.maxClaimsPerSpecialist) || config.maxClaimsPerSpecialist < 1) throw new Error("maxClaimsPerSpecialist must be a positive integer");
  if (!Number.isInteger(config.maxSourcesPerSpecialist) || config.maxSourcesPerSpecialist < 1) throw new Error("maxSourcesPerSpecialist must be a positive integer");
  return config;
}

/** Safe foundation executor: it reports missing evidence and performs no network or provider action. */
export const evidenceOnlySpecialistExecutor: SpecialistExecutor = {
  async execute(definition, input) {
    return specialistFindingSchema.parse({
      specialistId: definition.id,
      claims: [],
      sources: input.suppliedEvidence,
      confidence: 0,
      gaps: [`${definition.displayName} requires a configured evidence-producing executor.`],
      warnings: [],
    });
  },
};

