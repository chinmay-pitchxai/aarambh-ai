import type { Agent, AgentContext, RankerInput, RankerOutput } from "./types";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";

// ── Ranker Agent ──
// Rule-based 1-100 scoring → Hot/Warm/Cold bands
// LLM Lab can override via separate agent

interface ScoreInput {
  title: string | null;
  companySize: string | null;
  industry: string | null;
  city: string | null;
  freshness: Date | null;
  rawData: Record<string, unknown>;
}

function scoreLead(input: ScoreInput): { score: number; band: "hot" | "warm" | "cold" } {
  let score = 50; // baseline

  // Title scoring (0-25 points)
  const title = (input.title || "").toLowerCase();
  if (/\b(vp|vice president|director|head|chief|cto|ceo|cfo)\b/.test(title)) score += 25;
  else if (/\b(manager|lead|senior)\b/.test(title)) score += 15;
  else if (/\b(associate|analyst|coordinator)\b/.test(title)) score += 5;

  // Company size (0-15 points)
  const size = (input.companySize || "").toLowerCase();
  if (/^(1001|5001|10001|50001)/.test(size)) score += 15; // 1000+ employees
  else if (/^(201|501|1001)/.test(size)) score += 10;     // 200-1000
  else if (/^(51|201)/.test(size)) score += 5;             // 50-200

  // Industry fit (0-10 points)
  const industry = (input.industry || "").toLowerCase();
  if (/saas|software|technology|fintech/.test(industry)) score += 10;
  else if (/ecommerce|retail|healthcare/.test(industry)) score += 5;

  // Location (0-5 points)
  const city = (input.city || "").toLowerCase();
  if (/bangalore|bengaluru|mumbai|delhi|hyderabad/.test(city)) score += 5;
  else if (/pune|chennai|gurgaon|noida/.test(city)) score += 3;

  // Freshness penalty
  if (input.freshness) {
    const daysSince = (Date.now() - new Date(input.freshness).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 60) score -= 10;
    else if (daysSince > 30) score -= 5;
  }

  // Clamp 1-100
  score = Math.max(1, Math.min(100, score));

  const band = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
  return { score, band };
}

export const rankerAgent: Agent<RankerInput, RankerOutput> = {
  name: "ranker",

  async execute(input, ctx) {
    const { leadIds, clientId } = input;
    ctx.log("ranker start", { count: leadIds.length });

    let hot = 0, warm = 0, cold = 0;

    for (const leadId of leadIds) {
      // fetch lead from mother DB
      const [lead] = await db
        .select()
        .from(schema.leads)
        .where(eq(schema.leads.id, leadId))
        .limit(1);

      if (!lead) continue;

      const { score, band } = scoreLead({
        title: lead.title,
        companySize: lead.companySize,
        industry: lead.industry,
        city: lead.city,
        freshness: lead.freshness,
        rawData: (lead.rawData as Record<string, unknown>) || {},
      });

      // update client_leads score — scoped to clientId to avoid cross-client leak
      await db
        .update(schema.clientLeads)
        .set({ score, band })
        .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

      ctx.bus.publish({ type: "lead.scored", leadId, clientId, score, band });

      if (band === "hot") hot++;
      else if (band === "warm") warm++;
      else cold++;
    }

    ctx.log("ranker done", { hot, warm, cold });

    return { scored: leadIds.length, hot, warm, cold };
  },
};
