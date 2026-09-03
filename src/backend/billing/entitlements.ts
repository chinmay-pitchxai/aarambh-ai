import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { entitlementsSchema, type Entitlements } from "./plans";

export type BillingDb = PostgresJsDatabase<typeof schema>;
export type BillingTx = Parameters<Parameters<BillingDb["transaction"]>[0]>[0];
export type DbOrTx = BillingDb | BillingTx;

export type UsageResource = keyof Entitlements;

/** Resources that are consumed on a per-period basis. `seats` is not period-metered. */
export const USAGE_RESOURCES: readonly UsageResource[] = [
  "calls_per_month",
  "messages_per_month",
  "leads_per_month",
];

const VALID_RESOURCES = new Set<string>(Object.keys(entitlementsSchema.shape));

export class EntitlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntitlementError";
  }
}

export class NoActiveSubscriptionError extends EntitlementError {
  constructor(public readonly tenantId: string) {
    super(`No active subscription found for tenant ${tenantId}`);
    this.name = "NoActiveSubscriptionError";
  }
}

export class EntitlementExceededError extends EntitlementError {
  constructor(
    public readonly resource: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(`Entitlement '${resource}' limit exceeded: requested ${requested}, available ${available}`);
    this.name = "EntitlementExceededError";
  }
}

export interface UsageSummary {
  resource: UsageResource;
  used: number;
  reserved: number;
  limit: number;
  remaining: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface Reservation {
  reservationId: string;
  resource: UsageResource;
  amount: number;
  limit: number;
  used: number;
  reserved: number;
  remaining: number;
  periodStart: Date;
  periodEnd: Date;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}

function normalizeResource(resource: string): UsageResource {
  if (!VALID_RESOURCES.has(resource)) {
    throw new EntitlementError(`Unknown entitlement resource '${resource}'`);
  }
  return resource as UsageResource;
}

interface ActiveSubscription {
  planId: string;
  periodStart: Date;
  periodEnd: Date;
}

async function findActiveSubscription(db: DbOrTx, tenantId: string): Promise<ActiveSubscription | null> {
  const [row] = await db
    .select()
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.organizationId, tenantId), eq(schema.subscriptions.status, "active")))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1)
    .for("update");
  if (!row) return null;
  return {
    planId: row.planId,
    periodStart: row.currentPeriodStart ?? new Date(),
    periodEnd: row.currentPeriodEnd ?? new Date(),
  };
}

async function getPlanLimit(db: DbOrTx, planId: string, resource: UsageResource): Promise<number> {
  const plan = await db.query.plans.findFirst({ where: eq(schema.plans.id, planId) });
  if (!plan) throw new EntitlementError(`Plan ${planId} not found`);
  const entitlements = entitlementsSchema.parse(plan.entitlementsJson);
  return entitlements[resource];
}

async function sumUsage(
  db: DbOrTx,
  tenantId: string,
  resource: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ used: number; reserved: number }> {
  const rows = await db
    .select()
    .from(schema.entitlementUsage)
    .where(and(
      eq(schema.entitlementUsage.organizationId, tenantId),
      eq(schema.entitlementUsage.resource, resource),
      eq(schema.entitlementUsage.periodStart, periodStart),
      eq(schema.entitlementUsage.periodEnd, periodEnd),
    ));
  return rows.reduce(
    (acc, row) => ({ used: acc.used + (row.used ?? 0), reserved: acc.reserved + (row.reserved ?? 0) }),
    { used: 0, reserved: 0 },
  );
}

/**
 * Counts committed usage (used + reserved) for the tenant's current billing
 * period against the plan limit for `resource`.
 */
export async function checkEntitlement(db: DbOrTx, tenantId: string, resource: string): Promise<UsageSummary> {
  const key = normalizeResource(resource);
  const sub = await findActiveSubscription(db, tenantId);
  if (!sub) throw new NoActiveSubscriptionError(tenantId);
  const limit = await getPlanLimit(db, sub.planId, key);
  const usage = await sumUsage(db, tenantId, resource, sub.periodStart, sub.periodEnd);
  const committed = usage.used + usage.reserved;
  return {
    resource: key,
    used: usage.used,
    reserved: usage.reserved,
    limit,
    remaining: Math.max(0, limit - committed),
    periodStart: sub.periodStart,
    periodEnd: sub.periodEnd,
  };
}

/**
 * Atomically reserves `amount` of `resource` for the tenant's current period.
 * Each reservation gets a unique reservation id, later confirmed via
 * `finalizeUsage` or voided via `releaseReservation`.
 */
export async function reserveEntitlement(db: BillingDb, tenantId: string, resource: string, amount: number): Promise<Reservation> {
  const key = normalizeResource(resource);
  assertPositiveInteger(amount, "amount");
  const reservationId = randomUUID();

  return db.transaction(async (tx) => {
    const sub = await findActiveSubscription(tx, tenantId);
    if (!sub) throw new NoActiveSubscriptionError(tenantId);

    const limit = await getPlanLimit(tx, sub.planId, key);
    const usage = await sumUsage(tx, tenantId, resource, sub.periodStart, sub.periodEnd);
    const committed = usage.used + usage.reserved;
    if (committed + amount > limit) {
      throw new EntitlementExceededError(resource, amount, Math.max(0, limit - committed));
    }

    await tx.insert(schema.entitlementUsage).values({
      id: randomUUID(),
      organizationId: tenantId,
      planId: sub.planId,
      periodStart: sub.periodStart,
      periodEnd: sub.periodEnd,
      resource,
      used: 0,
      reserved: amount,
      reservationId,
    });

    return {
      reservationId,
      resource: key,
      amount,
      limit,
      used: usage.used,
      reserved: usage.reserved + amount,
      remaining: Math.max(0, limit - (committed + amount)),
      periodStart: sub.periodStart,
      periodEnd: sub.periodEnd,
    };
  });
}

/**
 * Confirms a reservation: moves `amount` from reserved to used.
 */
export async function finalizeUsage(db: BillingDb, tenantId: string, reservationId: string, amount: number): Promise<void> {
  assertPositiveInteger(amount, "amount");

  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.entitlementUsage)
      .where(and(
        eq(schema.entitlementUsage.organizationId, tenantId),
        eq(schema.entitlementUsage.reservationId, reservationId),
      ))
      .limit(1);
    if (!row) throw new EntitlementError(`Reservation ${reservationId} not found for tenant ${tenantId}`);
    if (amount > (row.reserved ?? 0)) {
      throw new EntitlementError(`Finalize amount ${amount} exceeds reserved ${row.reserved ?? 0} for reservation ${reservationId}`);
    }
    await tx
      .update(schema.entitlementUsage)
      .set({ used: (row.used ?? 0) + amount, reserved: (row.reserved ?? 0) - amount })
      .where(eq(schema.entitlementUsage.id, row.id));
  });
}

/**
 * Voids a reservation. If some of it was already finalized, the used portion
 * is kept and only the remaining reservation is released.
 */
export async function releaseReservation(db: BillingDb, tenantId: string, reservationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.entitlementUsage)
      .where(and(
        eq(schema.entitlementUsage.organizationId, tenantId),
        eq(schema.entitlementUsage.reservationId, reservationId),
      ))
      .limit(1);
    if (!row) throw new EntitlementError(`Reservation ${reservationId} not found for tenant ${tenantId}`);
    if ((row.used ?? 0) > 0) {
      await tx
        .update(schema.entitlementUsage)
        .set({ reserved: 0 })
        .where(eq(schema.entitlementUsage.id, row.id));
      return;
    }
    await tx.delete(schema.entitlementUsage).where(eq(schema.entitlementUsage.id, row.id));
  });
}