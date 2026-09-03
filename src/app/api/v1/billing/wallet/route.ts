import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { requireAuth } from "@/backend/auth/middleware";
import { getBalance } from "@/backend/billing/wallet";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const balance = await getBalance(db, auth.ctx.tenantId);

    const [wallet] = await db
      .select()
      .from(schema.wallets)
      .where(eq(schema.wallets.organizationId, auth.ctx.tenantId))
      .limit(1);

    const transactions = wallet
      ? await db
          .select()
          .from(schema.walletTransactions)
          .where(eq(schema.walletTransactions.walletId, wallet.id))
          .orderBy(desc(schema.walletTransactions.createdAt))
          .limit(20)
      : [];

    return NextResponse.json({
      balanceCents: balance.balanceCents,
      currency: balance.currency,
      transactions,
    });
  } catch (error) {
    console.error("[api/v1/billing/wallet]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}