import type { Agent, AgentContext, ConsentInput, ConsentOutput } from "./types";
import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Consent Gate ──
// Checks DNC global + client opt-in before any outreach
// Blocks if no consent → route to Park/DNC

export const consentAgent: Agent<ConsentInput, ConsentOutput> = {
  name: "consent",

  async execute(input, ctx) {
    const { leadId, clientId } = input;
    ctx.log("consent check", { leadId });

    // 1. Global DNC check
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, leadId))
      .limit(1);

    if (!lead) return { approved: false, reason: "lead not found" };
    if (lead.dnc === 1) return { approved: false, reason: "global_dnc" };

    // 2. Client-specific consent
    const [consentRow] = await db
      .select()
      .from(schema.consent)
      .where(and(eq(schema.consent.leadId, leadId), eq(schema.consent.clientId, clientId)))
      .limit(1);

    if (consentRow?.status === "opted_out") {
      ctx.log("consent opted_out", { leadId, reason: consentRow.source || "unknown" });
      return { approved: false, reason: "client_opted_out" };
    }

    if (consentRow?.status === "opted_in") {
      // Update checkedAt timestamp
      await db
        .update(schema.consent)
        .set({ checkedAt: new Date() })
        .where(and(eq(schema.consent.leadId, leadId), eq(schema.consent.clientId, clientId)));
      return { approved: true, reason: "opted_in" };
    }

    // 3. No consent record → default to approved (Apollo leads are B2B, implied consent)
    if (!consentRow) {
      try {
        await db.insert(schema.consent).values({
          id: randomUUID(),
          leadId,
          clientId,
          status: "opted_in",
          source: "apollo",
        });
      } catch {
        // race: another request already inserted — ignore duplicate
      }
      return { approved: true, reason: "implied_b2b_consent" };
    }

    // unknown status → block
    return { approved: false, reason: "consent_unknown" };
  },
};
