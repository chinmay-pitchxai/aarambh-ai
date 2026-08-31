import type { Agent, AgentContext, ScoutInput, ScoutOutput } from "./types";
import { db, schema } from "../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Scout Agent ──
// Pulls leads from mother DB (reuse) or Apollo (new), stores + dedupes

export const scoutAgent: Agent<ScoutInput, ScoutOutput> = {
  name: "scout",

  async execute(input, ctx) {
    const { clientId, icpTags, batchSize = 100 } = input;
    ctx.log("scout start", { icpTags, batchSize });

    // 1. Try mother DB reuse first — query leads directly (includes orphans)
    const reusedCandidates = await db
      .select({ leadId: schema.leads.id })
      .from(schema.leads)
      .where(
        and(
          sql`${schema.leads.icpTags} @> ${JSON.stringify(icpTags)}::jsonb`,
          sql`${schema.leads.freshness} > NOW() - INTERVAL '30 days'`,
          eq(schema.leads.dnc, 0),
        )
      )
      .limit(batchSize);

    const candidateIds = reusedCandidates.map((r) => r.leadId);
    const reusedIds: string[] = [];
    const newIds: string[] = [];

    if (candidateIds.length > 0) {
      // Batch check which candidates already assigned to this client
      const alreadyAssigned = await db
        .select({ leadId: schema.clientLeads.leadId })
        .from(schema.clientLeads)
        .where(and(eq(schema.clientLeads.clientId, clientId), inArray(schema.clientLeads.leadId, candidateIds)));

      const assignedSet = new Set(alreadyAssigned.map((r) => r.leadId));
      const toReuse = candidateIds.filter((id) => !assignedSet.has(id));

      if (toReuse.length > 0) {
        await db.insert(schema.clientLeads).values(
          toReuse.map((leadId) => ({
            id: randomUUID(),
            clientId,
            leadId,
            reusedFrom: "mother_pool" as const,
          })),
        );
        reusedIds.push(...toReuse);
      }
    }

    ctx.log("reused from mother DB", { count: reusedIds.length });

    // 2. If not enough, pull from Apollo
    const remaining = batchSize - reusedIds.length;
    if (remaining > 0) {
      const apolloLeads = await pullFromApollo(icpTags, remaining);
      for (const lead of apolloLeads) {
        // dedupe on phone
        const existing = await db
          .select()
          .from(schema.leads)
          .where(eq(schema.leads.phoneE164, lead.phoneE164))
          .limit(1);

        if (existing.length === 0) {
          const leadId = randomUUID();
          await db.insert(schema.leads).values({
            id: leadId,
            phoneE164: lead.phoneE164,
            email: lead.email,
            firstName: lead.firstName,
            lastName: lead.lastName,
            company: lead.company,
            title: lead.title,
            city: lead.city,
            industry: lead.industry,
            companySize: lead.companySize,
            sourceRef: lead.sourceRef,
            sourceCost: lead.sourceCost,
            rawData: lead.rawData,
            icpTags,
            freshness: new Date(),
          });
          await db.insert(schema.clientLeads).values({
            id: randomUUID(),
            clientId,
            leadId,
            reusedFrom: null,
          });
          newIds.push(leadId);
        }
      }
    }

    const allIds = [...reusedIds, ...newIds];
    if (allIds.length > 0) {
      ctx.bus.publish({ type: "lead.enriched", leadId: allIds[0], clientId, data: { count: allIds.length } });
    }

    return {
      leadsFound: allIds.length,
      leadsNew: newIds.length,
      leadsReused: reusedIds.length,
      leadIds: allIds,
    };
  },
};

// ── Apollo API (stub — replace with real fetch) ──

interface ApolloLead {
  phoneE164: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  city: string | null;
  industry: string | null;
  companySize: string | null;
  sourceRef: string | null;
  sourceCost: number;
  rawData: unknown;
}

async function pullFromApollo(icpTags: string[], limit: number): Promise<ApolloLead[]> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) return []; // no API key = skip Apollo

  // TODO: implement real Apollo People Search API
  // POST https://api.apollo.io/v1/mixed_people/search
  // Body: { q_keywords, person_titles, organization_industry_ids, per_page }
  // Then reveal_phone for each result

  return [];
}
