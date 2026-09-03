import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schemaModule from "../db/schema";
import { inboxEvents } from "../db/schema";

export type DrizzleDb = PostgresJsDatabase<typeof schemaModule>;

export interface InboxEventInput {
  tenantId: string;
  source: string;
  externalId: string;
  eventType?: string;
  payload?: unknown;
}

export interface InboxProcessResult {
  duplicate: boolean;
  cachedResult?: unknown;
  existing?: typeof inboxEvents.$inferSelect;
}

export async function processInboxEvent(db: DrizzleDb, event: InboxEventInput): Promise<InboxProcessResult> {
  const inserted = await db.insert(inboxEvents).values({
    tenantId: event.tenantId,
    eventType: event.eventType ?? "unknown",
    source: event.source,
    externalId: event.externalId,
    payload: event.payload ?? {},
  }).onConflictDoNothing().returning({ id: inboxEvents.id });

  if (inserted.length > 0) {
    return { duplicate: false };
  }

  const existing = await db.select().from(inboxEvents).where(and(
    eq(inboxEvents.tenantId, event.tenantId),
    eq(inboxEvents.source, event.source),
    eq(inboxEvents.externalId, event.externalId),
  )).limit(1);

  const row = existing[0];
  return {
    duplicate: true,
    cachedResult: row?.payload ?? null,
    existing: row,
  };
}

export async function isProcessed(db: DrizzleDb, source: string, externalId: string): Promise<boolean> {
  const rows = await db.select({ processedAt: inboxEvents.processedAt })
    .from(inboxEvents).where(and(
      eq(inboxEvents.source, source),
      eq(inboxEvents.externalId, externalId),
    )).limit(1);

  return rows[0]?.processedAt != null;
}

export async function markInboxProcessed(
  db: DrizzleDb,
  input: { tenantId: string; source: string; externalId: string },
): Promise<void> {
  await db.update(inboxEvents).set({
    processedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(inboxEvents.tenantId, input.tenantId),
    eq(inboxEvents.source, input.source),
    eq(inboxEvents.externalId, input.externalId),
  ));
}