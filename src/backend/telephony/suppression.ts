import { db, schema } from "../db";
import { eq, and, sql, inArray } from "drizzle-orm";

// ── Suppression & Calling Rules ──
// DNC checks, calling window enforcement, capacity gating.

const DEFAULT_CALLING_WINDOW = { startHour: 9, endHour: 18 };
const DEFAULT_MAX_CONCURRENT = 5;

// ── DNC Check ──

export async function isDnc(db: any, phoneE164: string): Promise<boolean> {
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.phoneE164, phoneE164))
    .limit(1);

  if (!lead) return false;
  if (lead.dnc === 1) return true;

  const consentRows = await db
    .select()
    .from(schema.consent)
    .where(eq(schema.consent.leadId, lead.id));

  return consentRows.some((row: { status: string }) => row.status === "opted_out");
}

// ── Calling Window ──

export function isInCallingWindow(
  date: Date,
  timezone?: string,
  window?: { startHour: number; endHour: number },
): boolean {
  const tz = timezone || "Asia/Kolkata";
  const w = window || DEFAULT_CALLING_WINDOW;

  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: tz,
  });
  const hour = parseInt(formatter.format(date), 10);

  const dayFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: tz,
  });
  const day = dayFormatter.format(date);

  if (day === "Sun") return false;

  return hour >= w.startHour && hour < w.endHour;
}

// ── Capacity Check ──

export async function canInitiateCall(
  db: any,
  tenantId: string,
  maxConcurrent?: number,
): Promise<boolean> {
  const max = maxConcurrent || DEFAULT_MAX_CONCURRENT;

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.calls)
    .where(
      and(
        eq(schema.calls.clientId, tenantId),
        sql`${schema.calls.startedAt} > now() - interval '1 hour'`,
        sql`${schema.calls.endedAt} IS NULL`,
      ),
    );

  const activeCount = result?.count ?? 0;
  return activeCount < max;
}
