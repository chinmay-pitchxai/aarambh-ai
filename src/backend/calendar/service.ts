import { and, asc, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { bookings, meetingReminders } from "../db/schema";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

// ── Calendar & Booking Service ──
// Slot availability, atomic booking (advisory lock + overlap check), cancel/confirm/reschedule.

export type CalendarDb = PostgresJsDatabase<typeof schema>;
export type BookingRow = typeof bookings.$inferSelect;

export interface AvailableSlot {
  start: Date;
  end: Date;
}

export class BookingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingConflictError";
  }
}

export class BookingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingNotFoundError";
  }
}

export class BookingNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingNotAllowedError";
  }
}

// Business hours: 09:00–18:00, Mon–Fri, 30-minute alignment.
export const BUSINESS_START_HOUR = 9;
export const BUSINESS_END_HOUR = 18;
export const SLOT_STEP_MIN = 30;
export const SLOT_LIMIT = 20;
export const DEFAULT_DURATION_MIN = 30;
const BOOKING_MAX_ATTEMPTS = 5;

export function durationMinOf(booking: { durationMin: number | null }): number {
  return booking.durationMin && booking.durationMin > 0 ? booking.durationMin : DEFAULT_DURATION_MIN;
}

export function overlaps(
  requestedStart: Date,
  requestedEnd: Date,
  existingStart: Date,
  existingDurationMin: number,
): boolean {
  const existingEnd = new Date(existingStart.getTime() + existingDurationMin * 60_000);
  return requestedStart < existingEnd && requestedEnd > existingStart;
}

function slotOverlapsAny(conflicts: Array<{ scheduledAt: Date; durationMin: number | null }>, start: Date, end: Date): boolean {
  return conflicts.some((c) => overlaps(start, end, c.scheduledAt, durationMinOf(c)));
}

// ── Slot availability ──
export async function getAvailableSlots(
  db: CalendarDb,
  input: { tenantId: string; leadId?: string; startDate: Date; endDate: Date; durationMin: number },
): Promise<AvailableSlot[]> {
  const { tenantId, startDate, endDate } = input;
  const duration = Math.max(1, Math.floor(input.durationMin));

  if (endDate <= startDate) return [];

  const conflicts = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.clientId, tenantId),
        ne(bookings.status, "cancelled"),
        lt(bookings.scheduledAt, endDate),
        gt(
          sql`${bookings.scheduledAt} + make_interval(mins => coalesce(${bookings.durationMin}, ${DEFAULT_DURATION_MIN}))`,
          startDate,
        ),
      ),
    );

  const slots: AvailableSlot[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const lastDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  for (let day = cursor; day <= lastDay; day = new Date(day.getTime() + dayMs)) {
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends

    for (
      let minutes = BUSINESS_START_HOUR * 60;
      minutes + duration <= BUSINESS_END_HOUR * 60;
      minutes += SLOT_STEP_MIN
    ) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
      const end = new Date(start.getTime() + duration * 60_000);

      if (start < startDate) continue;
      if (start >= endDate) break;
      if (slotOverlapsAny(conflicts, start, end)) continue;

      slots.push({ start, end });
      if (slots.length >= SLOT_LIMIT) return slots;
    }
  }

  return slots;
}

// ── Atomic booking ──
// Serialises bookings for the same tenant+slot via pg_advisory_xact_lock, then
// re-checks overlapping rows (SELECT ... FOR UPDATE) before inserting.
// The lock closes the "phantom slot" window where no existing row exists to lock.
async function atomicBook(
  db: CalendarDb,
  input: { tenantId: string; leadId: string; startTime: Date; durationMin: number; notes?: string | null; meetingUrl?: string | null },
): Promise<BookingRow> {
  const { tenantId, leadId, startTime } = input;
  const duration = Math.max(1, Math.floor(input.durationMin));
  const endTime = new Date(startTime.getTime() + duration * 60_000);
  const lockKey = `${tenantId}:${startTime.getTime()}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < BOOKING_MAX_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

        const conflicts = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(
            and(
              eq(bookings.clientId, tenantId),
              ne(bookings.status, "cancelled"),
              lt(bookings.scheduledAt, endTime),
              gt(
                sql`${bookings.scheduledAt} + make_interval(mins => coalesce(${bookings.durationMin}, ${DEFAULT_DURATION_MIN}))`,
                startTime,
              ),
            ),
          )
          .for("update");

        if (conflicts.length > 0) {
          throw new BookingConflictError(`Slot ${startTime.toISOString()} is already booked for this tenant`);
        }

        const bookingId = `bk_${randomUUID().slice(0, 12)}`;
        const [row] = await tx
          .insert(bookings)
          .values({
            id: bookingId,
            leadId,
            clientId: tenantId,
            status: "scheduled",
            scheduledAt: startTime,
            durationMin: duration,
            notes: input.notes ?? null,
            meetingUrl: input.meetingUrl ?? null,
          })
          .returning();

        return row;
      });
    } catch (err) {
      if (err instanceof BookingConflictError) throw err;
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to book meeting after retries");
}

export async function createMeeting(
  db: CalendarDb,
  input: { tenantId: string; leadId: string; startTime: Date; durationMin: number; title?: string; notes?: string; meetingUrl?: string },
): Promise<BookingRow> {
  return atomicBook(db, {
    tenantId: input.tenantId,
    leadId: input.leadId,
    startTime: input.startTime,
    durationMin: input.durationMin,
    notes: input.title ? `${input.title}${input.notes ? ` — ${input.notes}` : ""}` : (input.notes ?? null),
    meetingUrl: input.meetingUrl ?? null,
  });
}

// ── Reads ──
export async function getBooking(db: CalendarDb, tenantId: string, bookingId: string): Promise<BookingRow | null> {
  const rows = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.clientId, tenantId)))
    .limit(1);
  const row = rows[0];
  return row && row.clientId === tenantId ? row : null;
}

export async function listMeetings(
  db: CalendarDb,
  tenantId: string,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<BookingRow[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);

  const conditions = [eq(bookings.clientId, tenantId)];
  if (opts.status) conditions.push(eq(bookings.status, opts.status));

  const rows = await db
    .select()
    .from(bookings)
    .where(and(...conditions))
    .orderBy(descScheduledAt())
    .limit(limit)
    .offset(offset);

  return rows.filter((r) => r.clientId === tenantId);
}

function descScheduledAt() {
  return sql`${bookings.scheduledAt} desc`;
}

export async function listUpcoming(db: CalendarDb, tenantId: string, opts: { now?: Date } = {}): Promise<BookingRow[]> {
  const now = opts.now ?? new Date();
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.clientId, tenantId),
        inArray(bookings.status, ["scheduled", "confirmed"]),
        gte(bookings.scheduledAt, now),
      ),
    )
    .orderBy(asc(bookings.scheduledAt));

  return rows.filter((r) => r.clientId === tenantId);
}

// ── Mutations ──
export async function confirmMeeting(db: CalendarDb, tenantId: string, bookingId: string): Promise<BookingRow> {
  const existing = await getBooking(db, tenantId, bookingId);
  if (!existing) throw new BookingNotFoundError(`Booking ${bookingId} not found`);
  if (existing.status === "cancelled" || existing.status === "completed" || existing.status === "no_show") {
    throw new BookingNotAllowedError(`Cannot confirm a ${existing.status} booking`);
  }

  const [updated] = await db
    .update(bookings)
    .set({ status: "confirmed" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.clientId, tenantId)))
    .returning();

  if (!updated) throw new BookingNotFoundError(`Booking ${bookingId} not found`);
  return updated;
}

export async function cancelMeeting(db: CalendarDb, tenantId: string, bookingId: string): Promise<BookingRow> {
  const existing = await getBooking(db, tenantId, bookingId);
  if (!existing) throw new BookingNotFoundError(`Booking ${bookingId} not found`);
  if (existing.status === "cancelled" || existing.status === "completed") return existing;

  const [updated] = await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.clientId, tenantId)))
    .returning();

  if (!updated) throw new BookingNotFoundError(`Booking ${bookingId} not found`);

  await db
    .update(meetingReminders)
    .set({ status: "cancelled" })
    .where(and(eq(meetingReminders.bookingId, bookingId), eq(meetingReminders.status, "pending")));

  return updated;
}

export async function rescheduleMeeting(
  db: CalendarDb,
  tenantId: string,
  bookingId: string,
  newStart: Date,
  durationMin: number,
): Promise<BookingRow> {
  const duration = Math.max(1, Math.floor(durationMin));
  const endTime = new Date(newStart.getTime() + duration * 60_000);
  const lockKey = `${tenantId}:${newStart.getTime()}`;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const conflicts = await tx
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.clientId, tenantId),
          ne(bookings.status, "cancelled"),
          ne(bookings.id, bookingId),
          lt(bookings.scheduledAt, endTime),
          gt(
            sql`${bookings.scheduledAt} + make_interval(mins => coalesce(${bookings.durationMin}, ${DEFAULT_DURATION_MIN}))`,
            newStart,
          ),
        ),
      )
      .for("update");

    if (conflicts.length > 0) {
      throw new BookingConflictError(`Slot ${newStart.toISOString()} is already booked for this tenant`);
    }

    const [updated] = await tx
      .update(bookings)
      .set({ scheduledAt: newStart, durationMin: duration, status: "scheduled" })
      .where(and(eq(bookings.id, bookingId), eq(bookings.clientId, tenantId)))
      .returning();

    if (!updated) throw new BookingNotFoundError(`Booking ${bookingId} not found`);
    return updated;
  });
}