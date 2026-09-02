import { db, schema } from "../db";
import { eq, and, sql, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getVobizClient, type VobizClient } from "../integrations/vobiz";

// ── Number Provisioning ──
// Manages a pool of pre-provisioned Vobiz numbers.
// Assigns numbers to tenants, tracks state, handles release.

export type NumberStatus = "available" | "assigned" | "releasing" | "error";

export interface PhoneNumberRecord {
  id: string;
  tenantId: string | null;
  numberE164: string;
  provider: string;
  status: NumberStatus;
  provisionedAt: Date;
  assignedAt: Date | null;
  releasedAt: Date | null;
}

export interface ProvisioningResult {
  success: boolean;
  number?: string;
  error?: string;
}

// ── Pool Management ──

export class NumberPool {
  private client: VobizClient;

  constructor(client?: VobizClient) {
    this.client = client || getVobizClient();
  }

  /**
   * Search available numbers from Vobiz and store them as "available" in the pool.
   * Does NOT allocate them — just marks them as potential candidates.
   */
  async seedPool(areaCode: string, count: number): Promise<{ found: number; added: number }> {
    const searchType = areaCode === "800" ? "toll_free" : "local";
    const results = await this.client.searchNumbers(areaCode, searchType);

    let added = 0;
    for (const result of results.slice(0, count)) {
      const existing = await db
        .select()
        .from(schema.phoneNumbers)
        .where(eq(schema.phoneNumbers.numberE164, result.phoneNumber))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(schema.phoneNumbers).values({
          id: randomUUID(),
          numberE164: result.phoneNumber,
          provider: "vobiz",
          status: "available",
          provisionedAt: new Date(),
        });
        added++;
      }
    }

    return { found: results.length, added };
  }

  /**
   * Assign an available number to a tenant.
   * Allocates the number via Vobiz API and updates DB.
   */
  async assignNumber(tenantId: string, preferredAreaCode?: string): Promise<ProvisioningResult> {
    // Find an available number, preferring the area code
    const conditions = [eq(schema.phoneNumbers.status, "available")];
    if (preferredAreaCode) {
      conditions.push(sql`${schema.phoneNumbers.numberE164} LIKE ${"+" + preferredAreaCode + "%"}`);
    }

    const [available] = await db
      .select()
      .from(schema.phoneNumbers)
      .where(and(...conditions))
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (!available) {
      return { success: false, error: "No available numbers in pool" };
    }

    try {
      await this.client.allocateNumber(tenantId, available.numberE164);

      await db
        .update(schema.phoneNumbers)
        .set({
          tenantId,
          status: "assigned",
          assignedAt: new Date(),
        })
        .where(eq(schema.phoneNumbers.id, available.id));

      return { success: true, number: available.numberE164 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.phoneNumbers)
        .set({ status: "error" })
        .where(eq(schema.phoneNumbers.id, available.id));
      return { success: false, error: message };
    }
  }

  /**
   * Release a number from a tenant back to the pool.
   */
  async releaseNumber(phoneNumber: string): Promise<ProvisioningResult> {
    const [record] = await db
      .select()
      .from(schema.phoneNumbers)
      .where(eq(schema.phoneNumbers.numberE164, phoneNumber))
      .limit(1);

    if (!record) return { success: false, error: "Number not found" };
    if (record.status !== "assigned") return { success: false, error: `Number is ${record.status}, not assigned` };

    await db
      .update(schema.phoneNumbers)
      .set({ status: "releasing" })
      .where(eq(schema.phoneNumbers.id, record.id));

    try {
      await this.client.releaseNumber(phoneNumber);

      await db
        .update(schema.phoneNumbers)
        .set({
          tenantId: null,
          status: "available",
          assignedAt: null,
          releasedAt: new Date(),
        })
        .where(eq(schema.phoneNumbers.id, record.id));

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(schema.phoneNumbers)
        .set({ status: "error" })
        .where(eq(schema.phoneNumbers.id, record.id));
      return { success: false, error: message };
    }
  }

  /**
   * Get the number currently assigned to a tenant.
   */
  async getTenantNumber(tenantId: string): Promise<PhoneNumberRecord | null> {
    const [record] = await db
      .select()
      .from(schema.phoneNumbers)
      .where(
        and(
          eq(schema.phoneNumbers.tenantId, tenantId),
          eq(schema.phoneNumbers.status, "assigned"),
        ),
      )
      .limit(1);

    return record ? this.toRecord(record) : null;
  }

  /**
   * List all numbers in the pool with their status.
   */
  async listNumbers(filters?: { status?: NumberStatus; tenantId?: string }): Promise<PhoneNumberRecord[]> {
    const conditions: any[] = [];
    if (filters?.status) conditions.push(eq(schema.phoneNumbers.status, filters.status));
    if (filters?.tenantId) conditions.push(eq(schema.phoneNumbers.tenantId, filters.tenantId));

    const records = await db
      .select()
      .from(schema.phoneNumbers)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.phoneNumbers.provisionedAt));

    return records.map((record) => this.toRecord(record));
  }

  private toRecord(record: typeof schema.phoneNumbers.$inferSelect): PhoneNumberRecord {
    return {
      id: record.id,
      tenantId: record.tenantId,
      numberE164: record.numberE164,
      provider: record.provider ?? "vobiz",
      status: (record.status as NumberStatus) ?? "available",
      provisionedAt: record.provisionedAt ?? new Date(),
      assignedAt: record.assignedAt,
      releasedAt: record.releasedAt,
    };
  }

  /**
   * Get pool stats.
   */
  async getStats(): Promise<{ total: number; available: number; assigned: number; error: number }> {
    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        available: sql<number>`count(*) filter (where ${schema.phoneNumbers.status} = 'available')::int`,
        assigned: sql<number>`count(*) filter (where ${schema.phoneNumbers.status} = 'assigned')::int`,
        errored: sql<number>`count(*) filter (where ${schema.phoneNumbers.status} = 'error')::int`,
      })
      .from(schema.phoneNumbers);

    return {
      total: totals?.total || 0,
      available: totals?.available || 0,
      assigned: totals?.assigned || 0,
      error: totals?.errored || 0,
    };
  }
}

// Singleton
let _pool: NumberPool | null = null;

export function getNumberPool(): NumberPool {
  if (!_pool) {
    _pool = new NumberPool();
  }
  return _pool;
}
