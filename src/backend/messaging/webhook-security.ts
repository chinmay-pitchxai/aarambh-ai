import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import * as schema from "../db/schema";
import type { Db } from "./types";

export const DEFAULT_TENANT = "default";

export function sha256Hex(input: string): string {
  return createHmac("sha256", "webhook-dedupe").update(input).digest("hex");
}

/**
 * Verifies an `X-Hub-Signature-256` style HMAC signature computed over the raw
 * request body (Meta/Hub standard: `sha256=<hex>`).
 */
export function verifyHmacSignature(secret: string, rawBody: string, signatureHeader: string): boolean {
  if (!signatureHeader) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface PersistWebhookEventInput {
  tenantId?: string;
  source: string;
  eventType: string;
  headers: Record<string, string>;
  payload: unknown;
}

/** Persists the raw webhook delivery for audit/replay and returns its id. */
export async function persistWebhookEvent(
  db: Db,
  input: PersistWebhookEventInput,
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.webhookEvents).values({
    id,
    tenantId: input.tenantId ?? null,
    source: input.source,
    eventType: input.eventType,
    headers: input.headers,
    payload: input.payload,
    status: "received",
  });
  return id;
}

export interface RecordInboxEventInput {
  tenantId: string;
  source: string;
  externalId: string;
  eventType: string;
  payload: unknown;
}

/**
 * Registers a tenant-scoped event in the dedupe ledger.
 * Returns `true` when newly inserted, `false` when the (tenant, source,
 * externalId) triple was already processed. Relies on the `idx_inbox_dedup`
 * unique index. NOTE: `inbox_events.tenant_id` references `organizations.id`,
 * so callers must pass a real tenant id (webhooks without one should use the
 * client-scoped `messages` table for deduplication instead).
 */
export async function recordInboxEvent(
  db: Db,
  input: RecordInboxEventInput,
): Promise<boolean> {
  const inserted = await db
    .insert(schema.inboxEvents)
    .values({
      tenantId: input.tenantId,
      source: input.source,
      externalId: input.externalId,
      eventType: input.eventType,
      payload: input.payload,
      status: "published",
      processedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: schema.inboxEvents.id });

  return inserted.length > 0;
}