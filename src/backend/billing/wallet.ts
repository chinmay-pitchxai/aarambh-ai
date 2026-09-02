import { and, eq, gte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import * as schema from "../db/schema";
import type { BillingDb, DbOrTx } from "./entitlements";

export type WalletTransactionType = "credit" | "debit" | "refund" | "adjustment";

export type WalletTransactionRow = typeof schema.walletTransactions.$inferSelect;

export interface WalletBalance {
  walletId: string;
  balanceCents: number;
  currency: string;
}

export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletError";
  }
}

export class InsufficientFundsError extends WalletError {
  constructor(public readonly balanceCents: number, public readonly amountCents: number) {
    super(`Insufficient wallet balance: ${balanceCents} cents available, ${amountCents} cents required`);
    this.name = "InsufficientFundsError";
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}

function assertIdempotencyKey(idempotencyKey: string): void {
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    throw new TypeError("idempotencyKey is required");
  }
}

async function ensureWallet(db: DbOrTx, tenantId: string): Promise<{ id: string; balanceCents: number; currency: string }> {
  const [inserted] = await db
    .insert(schema.wallets)
    .values({
      id: randomUUID(),
      organizationId: tenantId,
      balanceCents: 0,
      currency: "INR",
    })
    .onConflictDoNothing({ target: [schema.wallets.organizationId] })
    .returning();
  if (inserted) return inserted;

  const existing = await db.query.wallets.findFirst({ where: eq(schema.wallets.organizationId, tenantId) });
  if (!existing) throw new WalletError(`Failed to ensure wallet for tenant ${tenantId}`);
  return existing;
}

async function findTransactionByIdempotency(db: DbOrTx, idempotencyKey: string): Promise<WalletTransactionRow | undefined> {
  return db.query.walletTransactions.findFirst({
    where: eq(schema.walletTransactions.idempotencyKey, idempotencyKey),
  });
}

/**
 * Returns the current wallet balance in integer cents, creating the wallet
 * row on first use.
 */
export async function getBalance(db: DbOrTx, tenantId: string): Promise<WalletBalance> {
  const wallet = await ensureWallet(db, tenantId);
  return { walletId: wallet.id, balanceCents: Number(wallet.balanceCents) || 0, currency: wallet.currency };
}

/**
 * Atomically moves money in/out of the tenant wallet. Idempotent per
 * `idempotencyKey`: replayed calls return the original transaction with no
 * balance side effect. Debits cannot drive the balance negative.
 */
async function applyWalletMutation(
  db: BillingDb,
  tenantId: string,
  amountCents: number,
  type: "credit" | "debit",
  description: string,
  idempotencyKey: string,
): Promise<WalletTransactionRow> {
  assertPositiveInteger(amountCents, "amountCents");
  assertIdempotencyKey(idempotencyKey);

  return db.transaction(async (tx) => {
    const existing = await findTransactionByIdempotency(tx, idempotencyKey);
    if (existing) return existing;

    const wallet = await ensureWallet(tx, tenantId);

    // Insert the transaction ledger row first so the unique idempotency index
    // guards against concurrent replays before any balance mutation.
    const [inserted] = await tx
      .insert(schema.walletTransactions)
      .values({
        id: randomUUID(),
        walletId: wallet.id,
        type,
        amountCents,
        balanceAfter: wallet.balanceCents,
        description,
        idempotencyKey,
      })
      .onConflictDoNothing({ target: [schema.walletTransactions.idempotencyKey] })
      .returning();
    if (!inserted) {
      const dup = await findTransactionByIdempotency(tx, idempotencyKey);
      if (!dup) throw new WalletError("Failed to record wallet transaction");
      return dup;
    }

    const isDebit = type === "debit";
    const [updated] = await tx
      .update(schema.wallets)
      .set({
        balanceCents: isDebit
          ? sql`${schema.wallets.balanceCents} - ${amountCents}`
          : sql`${schema.wallets.balanceCents} + ${amountCents}`,
        updatedAt: new Date(),
      })
      .where(isDebit
        ? and(eq(schema.wallets.id, wallet.id), gte(schema.wallets.balanceCents, amountCents))
        : eq(schema.wallets.id, wallet.id))
      .returning();

    if (!updated) {
      await tx.delete(schema.walletTransactions).where(eq(schema.walletTransactions.id, inserted.id));
      throw new InsufficientFundsError(wallet.balanceCents, amountCents);
    }

    await tx
      .update(schema.walletTransactions)
      .set({ balanceAfter: updated.balanceCents })
      .where(eq(schema.walletTransactions.id, inserted.id));

    return { ...inserted, balanceAfter: updated.balanceCents };
  });
}

/** Atomic debit. Throws `InsufficientFundsError` if balance cannot cover it. */
export async function debit(
  db: BillingDb,
  tenantId: string,
  amountCents: number,
  description: string,
  idempotencyKey: string,
): Promise<WalletTransactionRow> {
  return applyWalletMutation(db, tenantId, amountCents, "debit", description, idempotencyKey);
}

/** Atomic credit (e.g. wallet top-up). */
export async function credit(
  db: BillingDb,
  tenantId: string,
  amountCents: number,
  description: string,
  idempotencyKey: string,
): Promise<WalletTransactionRow> {
  return applyWalletMutation(db, tenantId, amountCents, "credit", description, idempotencyKey);
}