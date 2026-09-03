import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import * as schema from "../db/schema";
import type { Db, MessageChannel } from "./types";

// ── Conversation History ──

export interface ConversationTurn {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  sentAt: Date;
}

/**
 * Returns the last N messages for a lead on a specific channel, ordered oldest-first.
 */
export async function getConversationHistory(
  db: Db,
  opts: { leadId: string; clientId: string; channel: MessageChannel; limit?: number },
): Promise<ConversationTurn[]> {
  const limit = opts.limit ?? 10;

  const rows = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.leadId, opts.leadId),
        eq(schema.messages.clientId, opts.clientId),
        eq(schema.messages.channel, opts.channel),
      ),
    )
    .orderBy(desc(schema.messages.sentAt))
    .limit(limit);

  return rows
    .reverse()
    .map((r) => ({
      id: r.id,
      direction: r.direction as "inbound" | "outbound",
      body: r.body ?? "",
      sentAt: r.sentAt ?? new Date(),
    }));
}

/**
 * Persists one conversation turn (inbound or outbound) on the messages table.
 */
export async function saveConversationTurn(
  db: Db,
  opts: {
    leadId: string;
    clientId: string;
    channel: MessageChannel;
    direction: "inbound" | "outbound";
    body: string;
    waMessageId?: string;
    gmailThreadId?: string;
    idempotencyKey?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await db
    .insert(schema.messages)
    .values({
      id,
      leadId: opts.leadId,
      clientId: opts.clientId,
      channel: opts.channel,
      direction: opts.direction,
      body: opts.body,
      waMessageId: opts.waMessageId ?? null,
      gmailThreadId: opts.gmailThreadId ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
    })
    .onConflictDoNothing();
  return id;
}

// ── Lead Context for LLM ──

export interface LeadContext {
  leadId: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  status: string | null;
  band: string | null;
}

/**
 * Loads lead profile + client-lead status for building LLM context.
 */
export async function getLeadContext(
  db: Db,
  opts: { leadId: string; clientId: string },
): Promise<LeadContext | null> {
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, opts.leadId))
    .limit(1);

  if (!lead) return null;

  const [clientLead] = await db
    .select()
    .from(schema.clientLeads)
    .where(
      and(
        eq(schema.clientLeads.leadId, opts.leadId),
        eq(schema.clientLeads.clientId, opts.clientId),
      ),
    )
    .limit(1);

  return {
    leadId: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    company: lead.company,
    title: lead.title,
    email: lead.email,
    phone: lead.phoneE164,
    industry: lead.industry,
    status: clientLead?.status ?? null,
    band: clientLead?.band ?? null,
  };
}

/**
 * Returns business RAG data from the business_profiles table for the tenant.
 */
export async function getBusinessRagData(
  db: Db,
  opts: { clientId: string },
): Promise<string | null> {
  const [profile] = await db
    .select()
    .from(schema.businessProfiles)
    .innerJoin(
      schema.organizations,
      eq(schema.businessProfiles.organizationId, schema.organizations.id),
    )
    .where(eq(schema.organizations.id, opts.clientId))
    .limit(1);

  if (!profile) return null;

  const ragData = profile.business_profiles.ragData as Record<string, unknown> | null;
  if (!ragData) return null;

  return JSON.stringify(ragData);
}

/**
 * Returns the active prompt template for a client, if one exists.
 */
export async function getActivePrompt(
  db: Db,
  opts: { clientId: string },
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(schema.promptTemplates)
    .where(
      and(
        eq(schema.promptTemplates.tenantId, opts.clientId),
        eq(schema.promptTemplates.status, "active"),
      ),
    )
    .orderBy(desc(schema.promptTemplates.promptVersion))
    .limit(1);

  return row?.systemPrompt ?? null;
}
