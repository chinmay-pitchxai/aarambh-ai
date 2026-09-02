import { z } from "zod";

export const entitlementsSchema = z.object({
  calls_per_month: z.number().int().min(0),
  messages_per_month: z.number().int().min(0),
  leads_per_month: z.number().int().min(0),
  seats: z.number().int().min(1),
});

export type Entitlements = z.infer<typeof entitlementsSchema>;

export const intervalSchema = z.enum(["monthly", "annual"]);
export type Interval = z.infer<typeof intervalSchema>;

export const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  interval: intervalSchema,
  priceCents: z.number().int().min(0),
  currency: z.string().length(3),
  entitlements: entitlementsSchema,
  active: z.boolean(),
  version: z.number().int().min(1),
});

export type PlanDefinition = z.infer<typeof planSchema>;

const PLANS: PlanDefinition[] = [
  {
    id: "plan_starter_monthly_v1",
    name: "Starter",
    slug: "starter",
    interval: "monthly",
    priceCents: 4999,
    currency: "INR",
    entitlements: {
      calls_per_month: 500,
      messages_per_month: 1000,
      leads_per_month: 200,
      seats: 2,
    },
    active: true,
    version: 1,
  },
  {
    id: "plan_starter_annual_v1",
    name: "Starter",
    slug: "starter",
    interval: "annual",
    priceCents: 47988,
    currency: "INR",
    entitlements: {
      calls_per_month: 500,
      messages_per_month: 1000,
      leads_per_month: 200,
      seats: 2,
    },
    active: true,
    version: 1,
  },
  {
    id: "plan_growth_monthly_v1",
    name: "Growth",
    slug: "growth",
    interval: "monthly",
    priceCents: 14999,
    currency: "INR",
    entitlements: {
      calls_per_month: 2000,
      messages_per_month: 5000,
      leads_per_month: 1000,
      seats: 5,
    },
    active: true,
    version: 1,
  },
  {
    id: "plan_growth_annual_v1",
    name: "Growth",
    slug: "growth",
    interval: "annual",
    priceCents: 143988,
    currency: "INR",
    entitlements: {
      calls_per_month: 2000,
      messages_per_month: 5000,
      leads_per_month: 1000,
      seats: 5,
    },
    active: true,
    version: 1,
  },
  {
    id: "plan_enterprise_monthly_v1",
    name: "Enterprise",
    slug: "enterprise",
    interval: "monthly",
    priceCents: 49999,
    currency: "INR",
    entitlements: {
      calls_per_month: 10000,
      messages_per_month: 25000,
      leads_per_month: 5000,
      seats: 20,
    },
    active: true,
    version: 1,
  },
  {
    id: "plan_enterprise_annual_v1",
    name: "Enterprise",
    slug: "enterprise",
    interval: "annual",
    priceCents: 479988,
    currency: "INR",
    entitlements: {
      calls_per_month: 10000,
      messages_per_month: 25000,
      leads_per_month: 5000,
      seats: 20,
    },
    active: true,
    version: 1,
  },
];

export function getActivePlans(): PlanDefinition[] {
  return PLANS.filter((p) => p.active);
}

export function getPlanById(id: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.id === id && p.active);
}

export function getPlanBySlug(slug: string, interval: Interval): PlanDefinition | undefined {
  return PLANS.find((p) => p.slug === slug && p.interval === interval && p.active);
}

export function validatePlan(plan: unknown): PlanDefinition {
  return planSchema.parse(plan);
}
