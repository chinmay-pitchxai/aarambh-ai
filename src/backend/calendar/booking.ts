import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { bookings, meetingReminders } from "../db/schema";
import type { DurableQueue } from "../queue/durable-queue";
import {
  BookingNotFoundError,
  createMeeting,
  getAvailableSlots,
  type BookingRow,
  type CalendarDb,
} from "./service";

// ── Booking System ──
// Slot offering, atomic booking, reminder scheduling and no-show detection.

export const OFFER_SLOT_COUNT = 3;
export const REMINDER_DAY_BEFORE_MS = 24 * 60 * 60 * 1000;
export const REMINDER_DAY_OF_MS = 60 * 60 * 1000;
export const NO_SHOW_GRACE_MIN = 15;

export type ReminderType = "day_before" | "day_of";
export type ReminderRecord = typeof meetingReminders.$inferInsert;

function tomorrowStart(): Date {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return start;
}

// Propose 3 slots: the next N non-overlapping available slots from tomorrow onwards.
export async function offerSlots(
  db: CalendarDb,
  tenantId: string,
  leadId: string,
  opts: { startDate?: Date; durationMin?: number } = {},
): Promise<Array<{ start: Date; end: Date }>> {
  const startDate = opts.startDate ?? tomorrowStart();
  const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);
  const slots = await getAvailableSlots(db, {
    tenantId,
    leadId,
    startDate,
    endDate,
    durationMin: opts.durationMin ?? 30,
  });
  return slots.slice(0, OFFER_SLOT_COUNT);
}

// Atomic book with double-booking prevention (advisory lock + overlap check + retry).
export async function bookSlot(
  db: CalendarDb,
  tenantId: string,
  leadId: string,
  slotStart: Date,
  durationMin = 30,
): Promise<BookingRow> {
  return createMeeting(db, { tenantId, leadId, startTime: slotStart, durationMin });
}

// Create reminder records: day-before (24h) and day-of (1h) before the meeting.
// Optionally enqueues durable "meeting.reminder" jobs aligned to those offsets.
export async function scheduleReminders(
  db: CalendarDb,
  meetingId: string,
  queue?: DurableQueue,
): Promise<ReminderRecord[]> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, meetingId))
    .limit(1);

  if (!booking) throw new BookingNotFoundError(`Booking ${meetingId} not found`);
  if (booking.status === "cancelled" || booking.status === "completed" || booking.status === "no_show") return [];

  const start = booking.scheduledAt;
  const records = [
    {
      id: `rm_${randomUUID().slice(0, 12)}`,
      organizationId: booking.clientId,
      bookingId: meetingId,
      clientId: booking.clientId,
      leadId: booking.leadId,
      type: "day_before",
      reminderType: "day_before",
      scheduledAt: new Date(start.getTime() - REMINDER_DAY_BEFORE_MS),
      scheduledFor: new Date(start.getTime() - REMINDER_DAY_BEFORE_MS),
      channel: "whatsapp",
      status: "pending",
    },
    {
      id: `rm_${randomUUID().slice(0, 12)}`,
      organizationId: booking.clientId,
      bookingId: meetingId,
      clientId: booking.clientId,
      leadId: booking.leadId,
      type: "day_of",
      reminderType: "day_of",
      scheduledAt: new Date(start.getTime() - REMINDER_DAY_OF_MS),
      scheduledFor: new Date(start.getTime() - REMINDER_DAY_OF_MS),
      channel: "whatsapp",
      status: "pending",
    },
  ];

  // Invalidate any stale pending reminders for this booking (idempotency on re-schedule).
  await db
    .update(meetingReminders)
    .set({ status: "cancelled" })
    .where(and(eq(meetingReminders.bookingId, meetingId), eq(meetingReminders.status, "pending")));

  await db.insert(meetingReminders).values(records);

  if (queue) {
    for (const record of records) {
      await queue.enqueue(
        "meeting.reminder",
        { bookingId: meetingId, reminderId: record.id, reminderType: record.reminderType },
        { runAt: record.scheduledFor, tenantId: booking.clientId },
      );
    }
  }

  return records;
}

// After the meeting end time (+ grace), flag unattended scheduled meetings as no-shows.
export async function detectNoShow(
  db: CalendarDb,
  meetingId: string,
  opts: { now?: Date; graceMin?: number } = {},
): Promise<BookingRow> {
  const now = opts.now ?? new Date();
  const graceMs = (opts.graceMin ?? NO_SHOW_GRACE_MIN) * 60 * 1000;

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, meetingId))
    .limit(1);

  if (!booking) throw new BookingNotFoundError(`Booking ${meetingId} not found`);

  const end = new Date(booking.scheduledAt.getTime() + (booking.durationMin || 30) * 60 * 1000);
  if (now < new Date(end.getTime() + graceMs)) return booking;

  if (booking.status === "scheduled" || booking.status === "confirmed") {
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, meetingId));
    return { ...booking, status: "no_show" as const };
  }

  return booking;
}

// Re-export the conflict error so callers can catch it specifically.
export type { BookingConflictError } from "./service";