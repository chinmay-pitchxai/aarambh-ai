import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { requireAuth } from "@/backend/auth/middleware";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const [subscription] = await db
    .select()
    .from(schema.subscriptions)
    .where(and(
      eq(schema.subscriptions.organizationId, auth.ctx.tenantId),
      eq(schema.subscriptions.status, "active"),
    ))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1);

  if (!subscription) {
    return NextResponse.json({ subscription: null });
  }

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.id, subscription.planId))
    .limit(1);

  return NextResponse.json({
    subscription: {
      id: subscription.id,
      planId: subscription.planId,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      createdAt: subscription.createdAt,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            slug: plan.slug,
            interval: plan.interval,
            priceCents: plan.priceCents,
            currency: plan.currency,
            entitlements: plan.entitlementsJson,
          }
        : null,
    },
  });
}