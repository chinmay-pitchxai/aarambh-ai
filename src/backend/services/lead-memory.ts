import { randomUUID } from "crypto";
import { db, schema } from "../db";
import { eq, and, desc, lte } from "drizzle-orm";

export interface LeadMemoryRecord {
  id: string;
  tenantId: string;
  leadId: string;
  callId: string | null;
  summary: string;
  sentiment: string | null;
  bant: { budget?: string; authority?: string; need?: string; timeline?: string } | null;
  nextAction: string | null;
  scheduledCallbackAt: Date | null;
  previousCallContext: Record<string, unknown> | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export async function saveLeadMemory(input: {
  tenantId: string;
  leadId: string;
  callId?: string;
  summary: string;
  sentiment?: string;
  bant?: { budget?: string; authority?: string; need?: string; timeline?: string };
  nextAction?: string;
  scheduledCallbackAt?: Date;
  previousCallContext?: Record<string, unknown>;
  tags?: string[];
}): Promise<LeadMemoryRecord> {
  const id = randomUUID();
  const [record] = await db.insert(schema.leadMemory).values({
    id,
    tenantId: input.tenantId,
    leadId: input.leadId,
    callId: input.callId || null,
    summary: input.summary,
    sentiment: input.sentiment || null,
    bant: input.bant || null,
    nextAction: input.nextAction || null,
    scheduledCallbackAt: input.scheduledCallbackAt || null,
    previousCallContext: input.previousCallContext || null,
    tags: input.tags || [],
  }).returning();
  return record as LeadMemoryRecord;
}

export async function getLatestMemory(tenantId: string, leadId: string): Promise<LeadMemoryRecord | null> {
  const [record] = await db
    .select()
    .from(schema.leadMemory)
    .where(and(eq(schema.leadMemory.tenantId, tenantId), eq(schema.leadMemory.leadId, leadId)))
    .orderBy(desc(schema.leadMemory.createdAt))
    .limit(1);
  return (record as LeadMemoryRecord) || null;
}

export async function getLeadMemories(tenantId: string, leadId: string, limit = 20): Promise<LeadMemoryRecord[]> {
  const records = await db
    .select()
    .from(schema.leadMemory)
    .where(and(eq(schema.leadMemory.tenantId, tenantId), eq(schema.leadMemory.leadId, leadId)))
    .orderBy(desc(schema.leadMemory.createdAt))
    .limit(limit);
  return records as LeadMemoryRecord[];
}

export async function getDueCallbacks(tenantId: string): Promise<LeadMemoryRecord[]> {
  const now = new Date();
  const records = await db
    .select()
    .from(schema.leadMemory)
    .where(
      and(
        eq(schema.leadMemory.tenantId, tenantId),
        lte(schema.leadMemory.scheduledCallbackAt, now),
      )
    )
    .orderBy(schema.leadMemory.scheduledCallbackAt);
  return (records as LeadMemoryRecord[]).filter(
    (r) => r.scheduledCallbackAt !== null && r.nextAction !== null,
  );
}
