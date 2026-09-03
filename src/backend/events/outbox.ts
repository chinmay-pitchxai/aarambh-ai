import { randomUUID } from "node:crypto";
import { db, schema } from "@/backend/db";

export interface AppendOutboxEventInput {
  tenantId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * Persists a domain event to the transactional outbox table. A separate
 * dispatcher drains outbox_events and publishes them to the event bus.
 */
export async function appendOutboxEvent(input: AppendOutboxEventInput): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.outboxEvents).values({
    id,
    tenantId: input.tenantId,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
    status: "pending",
  });
  return id;
}

/**
 * Simple event emission helper. Records the event into the outbox so the
 * transactional publisher can pick it up. Returns the outbox event id.
 */
export async function emitEvent(input: AppendOutboxEventInput): Promise<string> {
  return appendOutboxEvent(input);
}