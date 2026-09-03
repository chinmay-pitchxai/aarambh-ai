import { createHmac } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import { Column, getTableName, Param, SQL, StringChunk } from "drizzle-orm";
import * as schema from "../db/schema";
import type { BillingDb } from "./entitlements";
import {
  checkEntitlement,
  EntitlementExceededError,
  finalizeUsage,
  NoActiveSubscriptionError,
  releaseReservation,
  reserveEntitlement,
} from "./entitlements";
import { credit, debit, getBalance, InsufficientFundsError } from "./wallet";
import { verifyPaymentWebhook, WebhookSecretNotConfiguredError } from "./webhook-signature";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory drizzle mock (no PostgreSQL required).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const COLUMNS_SYMBOL = Symbol.for("drizzle:Columns");

function tableRows(tbl: unknown): Row[] {
  const name = getTableName(tbl as never);
  const db = tables.get(name);
  if (!db) throw new Error(`Mock table "${name}" not seeded`);
  return db.rows;
}

function columnKey(column: unknown): string {
  const col = column as Column;
  const columns = (col.table as unknown as Record<symbol, unknown>)[COLUMNS_SYMBOL] as Record<string, Column>;
  if (columns) {
    for (const [key, value] of Object.entries(columns)) {
      if (value === col) return key;
    }
  }
  return (col as unknown as { name: string }).name;
}

function isColumn(value: unknown): value is Column {
  return value instanceof Column;
}

interface Atom {
  column: string;
  op: "=" | ">=";
  value: unknown;
}

function toChunkList(condition: unknown): unknown[] {
  return condition instanceof SQL ? condition.queryChunks : [condition];
}

function parseAtoms(condition: unknown): Atom[] {
  const atoms: Atom[] = [];
  const queue: unknown[] = toChunkList(condition);
  while (queue.length > 0) {
    const chunk = queue.shift();
    if (chunk instanceof SQL) {
      queue.unshift(...chunk.queryChunks);
      continue;
    }
    if (chunk instanceof StringChunk || chunk instanceof Param) continue;
    if (isColumn(chunk)) {
      const opChunk = queue.shift();
      const valChunk = queue.shift();
      let op: "=" | ">=" = "=";
      if (opChunk instanceof StringChunk) {
        const text = String(opChunk.value).trim();
        if (text === ">=" || text === ">") op = ">=";
      }
      let value: unknown = valChunk;
      if (valChunk instanceof Param) value = valChunk.value;
      atoms.push({ column: columnKey(chunk), op, value });
    }
  }
  return atoms;
}

function matches(row: Row, atoms: Atom[]): boolean {
  return atoms.every((atom) => {
    const actual = row[atom.column];
    if (atom.op === ">=") return (actual as number) >= (atom.value as number);
    return actual === atom.value;
  });
}

function parseOrder(order: unknown): { column: string; descending: boolean } {
  if (order instanceof Column) return { column: columnKey(order), descending: false };
  if (order instanceof SQL) {
    let column = "";
    let descending = false;
    for (const chunk of order.queryChunks) {
      if (chunk instanceof Column) column = columnKey(chunk);
      if (chunk instanceof StringChunk && String(chunk.value).includes("desc")) descending = true;
    }
    return { column, descending };
  }
  return { column: "", descending: false };
}

function applyOrder(rows: Row[], order: unknown): Row[] {
  const orders = Array.isArray(order) ? order : [order];
  let result = [...rows];
  for (const single of orders) {
    const { column, descending } = parseOrder(single);
    result = [...result].sort((a, b) => {
      const av = a[column] as string | number | Date;
      const bv = b[column] as string | number | Date;
      if (av instanceof Date && bv instanceof Date) {
        return descending ? bv.getTime() - av.getTime() : av.getTime() - bv.getTime();
      }
      if (av < bv) return descending ? 1 : -1;
      if (av > bv) return descending ? -1 : 1;
      return 0;
    });
  }
  return result;
}

function evalSetValue(value: unknown, row: Row): unknown {
  if (value instanceof SQL) {
    let left: number | undefined;
    let right: number | undefined;
    let op: string | undefined;
    for (const chunk of value.queryChunks) {
      if (chunk instanceof Column) left = row[columnKey(chunk)] as number;
      else if (chunk instanceof StringChunk) {
        const text = String(chunk.value).trim();
        if (text === "-" || text === "+") op = text;
      } else if (chunk instanceof Param) right = chunk.value as number;
    }
    if (left !== undefined && right !== undefined && op) return op === "-" ? left - right : left + right;
  }
  return value;
}

interface TableStore {
  rows: Row[];
}

const tables = new Map<string, TableStore>();

function createMockDb(seed: Record<string, Row[]>): { db: BillingDb; tables: Map<string, TableStore> } {
  tables.clear();
  for (const [name, rows] of Object.entries(seed)) {
    tables.set(name, { rows: rows.map((row) => ({ ...row })) });
  }

  const queryTargets: Array<[string, unknown]> = [
    ["subscriptions", schema.subscriptions],
    ["plans", schema.plans],
    ["wallets", schema.wallets],
    ["walletTransactions", schema.walletTransactions],
    ["entitlementUsage", schema.entitlementUsage],
    ["payments", schema.payments],
  ];

  const query: Record<string, { findFirst: (opts?: { where?: unknown; orderBy?: unknown }) => Promise<Row | undefined> }> = {};
  for (const [jsName, tableObj] of queryTargets) {
    query[jsName] = {
      findFirst: async (opts) => {
        let rows = [...tableRows(tableObj)];
        if (opts?.where) rows = rows.filter((row) => matches(row, parseAtoms(opts.where)));
        if (opts?.orderBy) rows = applyOrder(rows, opts.orderBy);
        return rows[0];
      },
    };
  }

  const select = () => ({
    from: (tbl: unknown) => {
      let atoms: Atom[] | null = null;
      let order: unknown = null;
      let limit: number | null = null;
      const builder = {
        where: (condition: unknown) => {
          atoms = parseAtoms(condition);
          return builder;
        },
        orderBy: (...args: unknown[]) => {
          order = args.length === 1 ? args[0] : args;
          return builder;
        },
        limit: (value: number) => {
          limit = value;
          return builder;
        },
        for: () => builder,
        then: (resolve: (value: Row[]) => void, reject: (reason?: unknown) => void) => {
          let result = [...tableRows(tbl)];
          const predicates = atoms ?? [];
          if (predicates.length > 0) result = result.filter((row) => matches(row, predicates));
          if (order) result = applyOrder(result, order);
          if (limit !== null) result = result.slice(0, limit);
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  });

  const insert = (tbl: unknown) => {
    let values: Row[] = [];
    let conflictTarget: unknown[] | null = null;
    const builder = {
      values: (row: Row) => {
        values = [row];
        return builder;
      },
      onConflictDoNothing: (opts?: { target?: unknown[] }) => {
        conflictTarget = opts?.target ?? null;
        return builder;
      },
      returning: async () => {
        const rows = tableRows(tbl);
        const inserted: Row[] = [];
        for (const row of values) {
          const conflict = conflictTarget !== null
            && conflictTarget.some((col) => rows.some((existing) => existing[columnKey(col)] === row[columnKey(col)]));
          if (conflict) continue;
          const copy = { ...row };
          rows.push(copy);
          inserted.push(copy);
        }
        return inserted;
      },
      then: async (resolve: (value: { rowCount: number }) => void, reject: (reason?: unknown) => void) => {
        try {
          await builder.returning();
          resolve({ rowCount: values.length });
        } catch (error) {
          reject(error);
        }
      },
    };
    return builder;
  };

  const update = (tbl: unknown) => {
    let set: Row = {};
    let condition: unknown;
    const builder = {
      set: (values: Row) => {
        set = values;
        return builder;
      },
      where: (where: unknown) => {
        condition = where;
        return builder;
      },
      returning: async () => {
        const rows = tableRows(tbl);
        const atoms = condition ? parseAtoms(condition) : [];
        const updated: Row[] = [];
        for (const row of rows) {
          if (!matches(row, atoms)) continue;
          const next = { ...row };
          for (const [key, value] of Object.entries(set)) next[key] = evalSetValue(value, row);
          Object.assign(row, next);
          updated.push({ ...next });
        }
        return updated;
      },
      then: async (resolve: (value: { rowCount: number }) => void, reject: (reason?: unknown) => void) => {
        try {
          await builder.returning();
          resolve({ rowCount: 0 });
        } catch (error) {
          reject(error);
        }
      },
    };
    return builder;
  };

  const del = (tbl: unknown) => {
    let condition: unknown;
    const builder = {
      where: (where: unknown) => {
        condition = where;
        return builder;
      },
      then: async (resolve: (value: { rowCount: number }) => void, reject: (reason?: unknown) => void) => {
        try {
          const rows = tableRows(tbl);
          const atoms = condition ? parseAtoms(condition) : [];
          for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (matches(rows[index], atoms)) rows.splice(index, 1);
          }
          resolve({ rowCount: 0 });
        } catch (error) {
          reject(error);
        }
      },
    };
    return builder;
  };

  const db = {
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    query,
    select,
    insert,
    update,
    delete: del,
  };

  return { db: db as unknown as BillingDb, tables };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TENANT = "tenant-1";
const PLAN_ID = "plan_starter_monthly_v1";
const PERIOD_START = new Date("2026-09-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-10-01T00:00:00.000Z");

function seedBilling() {
  return createMockDb({
    subscriptions: [
      {
        id: "sub-1",
        organizationId: TENANT,
        planId: PLAN_ID,
        status: "active",
        currentPeriodStart: PERIOD_START,
        currentPeriodEnd: PERIOD_END,
        createdAt: new Date("2026-08-30T00:00:00.000Z"),
      },
    ],
    plans: [
      {
        id: PLAN_ID,
        name: "Starter",
        slug: "starter",
        interval: "monthly",
        priceCents: 4999,
        currency: "INR",
        entitlementsJson: {
          calls_per_month: 10,
          messages_per_month: 100,
          leads_per_month: 20,
          seats: 2,
        },
        active: true,
        version: 1,
      },
    ],
    wallets: [],
    wallet_transactions: [],
    entitlement_usage: [],
    payments: [],
  });
}

let mock: ReturnType<typeof seedBilling>;
let db: BillingDb;

beforeEach(() => {
  mock = seedBilling();
  db = mock.db;
});

// ─────────────────────────────────────────────────────────────────────────────
// Entitlements
// ─────────────────────────────────────────────────────────────────────────────

describe("entitlements", () => {
  it("reports committed usage and remaining headroom", async () => {
    const summary = await checkEntitlement(db, TENANT, "calls_per_month");
    expect(summary.used).toBe(0);
    expect(summary.reserved).toBe(0);
    expect(summary.limit).toBe(10);
    expect(summary.remaining).toBe(10);
    expect(summary.periodStart).toEqual(PERIOD_START);
  });

  it("throws for a tenant without an active subscription", async () => {
    await expect(checkEntitlement(db, "no-sub-tenant", "calls_per_month")).rejects.toBeInstanceOf(NoActiveSubscriptionError);
    await expect(reserveEntitlement(db, "no-sub-tenant", "calls_per_month", 1)).rejects.toBeInstanceOf(NoActiveSubscriptionError);
  });

  it("reserves, finalizes and releases usage without double counting", async () => {
    const first = await reserveEntitlement(db, TENANT, "calls_per_month", 3);
    const second = await reserveEntitlement(db, TENANT, "calls_per_month", 5);

    expect(first.reservationId).not.toBe(second.reservationId);
    expect(first.reserved).toBe(3);
    expect(second.reserved).toBe(8);
    expect(second.remaining).toBe(2);

    // Partial finalize: 2 of the first reservation becomes used.
    await finalizeUsage(db, TENANT, first.reservationId, 2);
    const afterFinalize = await checkEntitlement(db, TENANT, "calls_per_month");
    expect(afterFinalize.used).toBe(2);
    expect(afterFinalize.reserved).toBe(6); // 1 remaining from first + 5 from second
    expect(afterFinalize.remaining).toBe(2);

    // Releasing the fully-reserved second reservation frees its headroom.
    await releaseReservation(db, TENANT, second.reservationId);
    const afterRelease = await checkEntitlement(db, TENANT, "calls_per_month");
    expect(afterRelease.used).toBe(2);
    expect(afterRelease.reserved).toBe(1);
    expect(afterRelease.remaining).toBe(7);
  });

  it("rejects reservations beyond the plan limit", async () => {
    await reserveEntitlement(db, TENANT, "calls_per_month", 8);
    await expect(reserveEntitlement(db, TENANT, "calls_per_month", 3)).rejects.toBeInstanceOf(EntitlementExceededError);
  });

  it("treats unknown resources as errors and validates amounts", async () => {
    await expect(checkEntitlement(db, TENANT, "seats")).resolves.toBeTruthy();
    await expect(checkEntitlement(db, TENANT, "not_a_resource")).rejects.toThrow(/Unknown entitlement resource/);
    await expect(reserveEntitlement(db, TENANT, "calls_per_month", 0)).rejects.toThrow(/positive integer/);
  });

  it("rejects finalizing more than was reserved", async () => {
    const reservation = await reserveEntitlement(db, TENANT, "messages_per_month", 4);
    await expect(finalizeUsage(db, TENANT, reservation.reservationId, 5)).rejects.toThrow(/exceeds reserved/);
  });

  it("releases partially finalized reservations keeping the used portion", async () => {
    const reservation = await reserveEntitlement(db, TENANT, "leads_per_month", 6);
    await finalizeUsage(db, TENANT, reservation.reservationId, 4);
    await releaseReservation(db, TENANT, reservation.reservationId);
    const summary = await checkEntitlement(db, TENANT, "leads_per_month");
    expect(summary.used).toBe(4);
    expect(summary.reserved).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wallet
// ─────────────────────────────────────────────────────────────────────────────

describe("wallet", () => {
  it("creates a wallet on first use with zero balance", async () => {
    const balance = await getBalance(db, TENANT);
    expect(balance.balanceCents).toBe(0);
    expect(balance.currency).toBe("INR");
    expect(mock.tables.get("wallets")?.rows).toHaveLength(1);
  });

  it("credits and debits atomically", async () => {
    const creditTx = await credit(db, TENANT, 1000, "top-up", "key-credit-1");
    expect(creditTx.type).toBe("credit");
    expect(creditTx.balanceAfter).toBe(1000);

    const balanceAfterCredit = await getBalance(db, TENANT);
    expect(balanceAfterCredit.balanceCents).toBe(1000);

    const debitTx = await debit(db, TENANT, 400, "call charge", "key-debit-1");
    expect(debitTx.type).toBe("debit");
    expect(debitTx.balanceAfter).toBe(600);

    expect((await getBalance(db, TENANT)).balanceCents).toBe(600);
    expect(mock.tables.get("wallet_transactions")?.rows).toHaveLength(2);
  });

  it("is idempotent for repeated idempotency keys", async () => {
    const first = await credit(db, TENANT, 500, "top-up", "key-same");
    const replay = await credit(db, TENANT, 500, "top-up", "key-same");

    expect(replay.id).toBe(first.id);
    expect((await getBalance(db, TENANT)).balanceCents).toBe(500);
    expect(mock.tables.get("wallet_transactions")?.rows).toHaveLength(1);

    const debitFirst = await debit(db, TENANT, 100, "charge", "key-debit-same");
    const debitReplay = await debit(db, TENANT, 100, "charge", "key-debit-same");
    expect(debitReplay.id).toBe(debitFirst.id);
    expect((await getBalance(db, TENANT)).balanceCents).toBe(400);
  });

  it("throws InsufficientFundsError on overdraw without side effects", async () => {
    await credit(db, TENANT, 100, "top-up", "key-credit-2");

    await expect(debit(db, TENANT, 200, "overdraw", "key-overdraw")).rejects.toBeInstanceOf(InsufficientFundsError);
    expect((await getBalance(db, TENANT)).balanceCents).toBe(100);

    // The failed debit left no ledger row behind.
    expect(mock.tables.get("wallet_transactions")?.rows).toHaveLength(1);
  });

  it("throws InsufficientFundsError when debiting an empty wallet", async () => {
    await expect(debit(db, TENANT, 50, "charge", "key-empty")).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it("validates positive integer amounts and requires idempotency keys", async () => {
    await expect(credit(db, TENANT, -5, "bad", "key-bad")).rejects.toThrow(/positive integer/);
    await expect(debit(db, TENANT, 10, "bad", "")).rejects.toThrow(/idempotencyKey is required/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook signature
// ─────────────────────────────────────────────────────────────────────────────

describe("webhook signature", () => {
  const secret = "test-webhook-secret";
  const body = JSON.stringify({ event: "payment.succeeded", amount_cents: 4999 });

  it("verifies a valid HMAC-SHA256 signature", () => {
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");
    expect(verifyPaymentWebhook(body, signature, secret)).toBe(true);
  });

  it("verifies the sha256=<hex> prefixed form", () => {
    const signature = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    expect(verifyPaymentWebhook(body, signature, secret)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    expect(verifyPaymentWebhook(body, "deadbeef", secret)).toBe(false);
    expect(verifyPaymentWebhook(body, "", secret)).toBe(false);
  });

  it("rejects a signature computed with a different secret", () => {
    const signature = createHmac("sha256", "wrong-secret").update(body, "utf8").digest("hex");
    expect(verifyPaymentWebhook(body, signature, secret)).toBe(false);
  });

  it("throws when no secret is configured", () => {
    const previous = process.env.BILLING_WEBHOOK_SECRET;
    delete process.env.BILLING_WEBHOOK_SECRET;
    try {
      expect(() => verifyPaymentWebhook(body, "abc")).toThrow(WebhookSecretNotConfiguredError);
    } finally {
      if (previous !== undefined) process.env.BILLING_WEBHOOK_SECRET = previous;
    }
  });
});
