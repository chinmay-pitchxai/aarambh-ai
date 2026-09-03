import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { bookings, leads, meetingReminders, messages } from "../db/schema";
import { db } from "../db";
import type { DurableQueue, Job } from "../queue/durable-queue";
import { sendReminderMessage, type ReminderMessageInput, type ReminderMessageResult } from "../messaging";

// ── Reminder Worker ──
// Durable queue handler for `meeting.reminder` jobs. Sends the day-before / day-of
// reminder via the messaging service (WhatsApp) and records a structured reminder
// record on the meeting_reminders + messages tables.

export interface ReminderJobPayload {
  bookingId: string;
  reminderId: string;
  reminderType: "day_before" | "day_of";
}

export interface ReminderWorkerOptions {
  workerId?: string;
  // Injectable sender for tests / alternate channels.
  send?: (input: ReminderMessageInput) => Promise<ReminderMessageResult>;
}

export type ReminderWorker = {
  workerId: string;
  handle: (job: Job) => Promise<void>;
};

const TEMPLATES: Record<ReminderJobPayload["reminderType"], string> = {
  day_before: "meeting_reminder_day_before",
  day_of: "meeting_reminder_day_of",
};

async function fetchLeadFor(leadId: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  return lead ?? null;
}

async function fetchReminder(reminderId: string) {
  const [reminder] = await db.select().from(meetingReminders).where(eq(meetingReminders.id, reminderId)).limit(1);
  return reminder ?? null;
}

export function createReminderWorker(queue: DurableQueue, options: ReminderWorkerOptions = {}): ReminderWorker {
  const workerId = options.workerId ?? `reminder-worker-${randomUUID().slice(0, 6)}`;
  const send = options.send ?? sendReminderMessage;

  async function processJob(job: Job): Promise<void> {
    if (job.type !== "meeting.reminder") {
      throw new Error(`Unexpected job type "${job.type}" — expected "meeting.reminder"`);
    }

    const payload = job.payload as ReminderJobPayload;
    const reminder = await fetchReminder(payload.reminderId);
    if (!reminder) throw new Error(`Reminder ${payload.reminderId} not found`);

    const [booking] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, payload.bookingId), reminder.clientId ? eq(bookings.clientId, reminder.clientId) : sql`true`))
      .limit(1);
    if (!booking) throw new Error(`Booking ${payload.bookingId} not found`);

    // If the meeting is no longer active, cancel the pending reminder instead of sending.
    if (booking.status === "cancelled" || booking.status === "completed" || booking.status === "no_show") {
      await db
        .update(meetingReminders)
        .set({ status: "cancelled" })
        .where(eq(meetingReminders.id, reminder.id));
      return;
    }

    const lead = await fetchLeadFor(booking.leadId);
    const meetingTime = booking.scheduledAt.toLocaleString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const location = booking.meetingUrl || "Meeting link to be shared";

    const result = await send({
      channel: "whatsapp",
      to: lead?.phoneE164 ?? null,
      templateName: TEMPLATES[payload.reminderType],
      params:
        payload.reminderType === "day_before"
          ? [lead?.firstName || "there", meetingTime, location, "Prepare any questions you'd like to discuss"]
          : [lead?.firstName || "there", booking.scheduledAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }), location],
    });

    if (result.ok && result.providerMessageId) {
      await db
        .update(meetingReminders)
        .set({ status: "sent", sentAt: new Date(), error: null })
        .where(eq(meetingReminders.id, reminder.id));

      if (payload.reminderType === "day_before") {
        await db.update(bookings).set({ reminderDayBeforeSent: true }).where(eq(bookings.id, booking.id));
      } else {
        await db.update(bookings).set({ reminderDayOfSent: true }).where(eq(bookings.id, booking.id));
      }

      await db.insert(messages).values({
        id: randomUUID(),
        leadId: booking.leadId,
        clientId: booking.clientId,
        callId: booking.callId,
        channel: "whatsapp",
        direction: "outbound",
        body: `${payload.reminderType} reminder sent for meeting on ${meetingTime}`,
        waMessageId: result.providerMessageId,
        templateName: TEMPLATES[payload.reminderType],
      });
    } else {
      await db
        .update(meetingReminders)
        .set({ status: "failed", error: result.error ?? "Send failed" })
        .where(eq(meetingReminders.id, reminder.id));
      throw new Error(result.error ?? "Reminder send failed");
    }
  }

  return {
    workerId,
    async handle(job) {
      try {
        await processJob(job);
        await queue.complete(job.id, workerId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await queue.fail(job.id, workerId, message);
      }
    },
  };
}