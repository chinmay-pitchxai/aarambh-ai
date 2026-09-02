import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/backend/db";
import { verifyPaymentWebhook } from "@/backend/billing/webhook-signature";
import { credit } from "@/backend/billing/wallet";

const webhookEventSchema = z.object({
  event: z.enum(["subscription.created", "subscription.updated", "payment.succeeded", "payment.failed"]),
  id: z.string().optional(),
  organization_id: z.string(),
  provider_ref: z.string(),
  idempotency_key: z.string(),
  amount_cents: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  plan_id: z.string().optional(),
  plan_slug: z.string().optional(),
  plan_interval: z.enum(["monthly", "annual"]).optional(),
  status: z.string().optional(),
  current_period_start: z.string().optional(),
  current_period_end: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

type WebhookEvent = z.infer<typeof webhookEventSchema>;

const SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "canceled", "expired"]);

function mapSubscriptionStatus(status: string | undefined, fallback: "active" | "canceled"): "active" | "trialing" | "past_due" | "canceled" | "expired" {
  if (status && SUBSCRIPTION_STATUSES.has(status)) {
    return status as "active" | "trialing" | "past_due" | "canceled" | "expired";
  }
  return fallback;
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function upsertSubscription(event: WebhookEvent): Promise<string | null> {
  const planId = event.plan_id;
  const periodStart = toDate(event.current_period_start);
  const periodEnd = toDate(event.current_period_end);
  if (!planId || !periodStart || !periodEnd) return null;

  const [existing] = await db
    .select()
    .from(schema.subscriptions)
    .where(and(
      eq(schema.subscriptions.organizationId, event.organization_id),
      eq(schema.subscriptions.planId, planId),
    ))
    .limit(1);

  if (existing) {
    const status = mapSubscriptionStatus(event.status, existing.status === "canceled" ? "canceled" : "active");
    await db
      .update(schema.subscriptions)
      .set({ status, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd })
      .where(eq(schema.subscriptions.id, existing.id));
    return existing.id;
  }

  const subscriptionId = randomUUID();
  await db.insert(schema.subscriptions).values({
    id: subscriptionId,
    organizationId: event.organization_id,
    planId,
    status: mapSubscriptionStatus(event.status, "active"),
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  });
  return subscriptionId;
}

async function handlePaymentSucceeded(event: WebhookEvent): Promise<void> {
  const amountCents = event.amount_cents ?? 0;
  if (amountCents <= 0) throw new Error("payment.succeeded requires a positive amount_cents");

  const subscriptionId = event.metadata?.purpose === "subscription"
    ? await upsertSubscription(event)
    : undefined;

  const paymentId = randomUUID();
  await db.insert(schema.payments).values({
    id: paymentId,
    organizationId: event.organization_id,
    subscriptionId: subscriptionId ?? null,
    amountCents,
    currency: event.currency ?? "INR",
    status: "succeeded",
    providerRef: event.provider_ref,
    idempotencyKey: event.idempotency_key,
  });

  if (event.metadata?.purpose !== "subscription") {
    await credit(
      db,
      event.organization_id,
      amountCents,
      `Payment received (${event.provider_ref})`,
      `billing:payment:${event.idempotency_key}`,
    );
  }

  await db.insert(schema.outboxEvents).values({
    tenantId: event.organization_id,
    eventType: "billing.payment_received",
    aggregateType: "payment",
    aggregateId: paymentId,
    payload: {
      paymentId,
      organizationId: event.organization_id,
      providerRef: event.provider_ref,
      amountCents,
      currency: event.currency ?? "INR",
      subscriptionId: subscriptionId ?? null,
      purpose: event.metadata?.purpose ?? "wallet",
    },
    status: "pending",
  });
}

async function handleSubscriptionEvent(event: WebhookEvent): Promise<void> {
  await upsertSubscription(event);
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-webhook-signature") ?? request.headers.get("x-signature") ?? "";

  let verified: boolean;
  try {
    verified = verifyPaymentWebhook(rawBody, signature);
  } catch {
    return NextResponse.json({ error: "Webhook secret is not configured" }, { status: 500 });
  }
  if (!verified) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = webhookEventSchema.safeParse(parsed);
  if (!result.success) {
    return NextResponse.json({ error: "Invalid webhook payload", details: result.error.flatten() }, { status: 400 });
  }
  const event = result.data;

  // Idempotency: skip events already processed for this provider reference + key.
  const existing = await db.query.payments.findFirst({
    where: and(
      eq(schema.payments.providerRef, event.provider_ref),
      eq(schema.payments.idempotencyKey, event.idempotency_key),
    ),
  });
  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.event) {
      case "payment.succeeded":
        await handlePaymentSucceeded(event);
        break;
      case "payment.failed": {
        const paymentId = randomUUID();
        await db.insert(schema.payments).values({
          id: paymentId,
          organizationId: event.organization_id,
          amountCents: event.amount_cents ?? 0,
          currency: event.currency ?? "INR",
          status: "failed",
          providerRef: event.provider_ref,
          idempotencyKey: event.idempotency_key,
        });
        break;
      }
      case "subscription.created":
      case "subscription.updated":
        await handleSubscriptionEvent(event);
        break;
      default:
        return NextResponse.json({ error: "Unsupported event type" }, { status: 400 });
    }
  } catch (error) {
    console.error("[billing/webhook]", event.event, error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}