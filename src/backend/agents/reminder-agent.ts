import { db, schema } from "../db";
import { eq, and, gte, lte, lt } from "drizzle-orm";
import { randomUUID } from "crypto";

// ── Reminder Agent ──
// Sends day-before and day-of reminders for bookings.
// Also detects no-shows after meetings.

const WA_API = "https://graph.facebook.com/v19.0";
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const WA_TOKEN = process.env.WHATSAPP_API_TOKEN;

async function sendWhatsAppReminder(phoneE164: string | null, templateName: string, params: string[]): Promise<string | null> {
  if (!phoneE164) return null;
  if (!WA_PHONE_ID || !WA_TOKEN) {
    console.log(`[WA-STUB] To: ${phoneE164}, Template: ${templateName}`);
    return `wa-stub-${randomUUID().slice(0, 8)}`;
  }

  const res = await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phoneE164,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }],
      },
    }),
  });

  if (!res.ok) {
    console.error(`WA send failed: ${res.status}`);
    return null;
  }
  const data = await res.json();
  return data.messages?.[0]?.id || null;
}

export async function checkDayBeforeReminders(): Promise<number> {
  const now = new Date();
  const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  const pendingBookings = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "scheduled"),
        eq(schema.bookings.reminderDayBeforeSent, false),
        gte(schema.bookings.scheduledAt, now),
        lte(schema.bookings.scheduledAt, in25Hours),
      ),
    );

  let count = 0;

  for (const booking of pendingBookings) {
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, booking.leadId))
      .limit(1);

    if (!lead) continue;

    const meetingTime = booking.scheduledAt.toLocaleString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const location = booking.meetingUrl || "Meeting link to be shared";

    const waId = await sendWhatsAppReminder(lead.phoneE164, "meeting_reminder_day_before", [
      lead.firstName || "there",
      meetingTime,
      location,
      "Prepare any questions you'd like to discuss",
    ]);

    if (waId) {
      await db
        .update(schema.bookings)
        .set({ reminderDayBeforeSent: true })
        .where(eq(schema.bookings.id, booking.id));

      await db.insert(schema.messages).values({
        id: randomUUID(),
        leadId: booking.leadId,
        clientId: booking.clientId,
        callId: booking.callId,
        channel: "whatsapp",
        direction: "outbound",
        body: `Day-before reminder sent for meeting on ${meetingTime}`,
        waMessageId: waId,
        templateName: "meeting_reminder_day_before",
      });

      count++;
    }
  }

  return count;
}

export async function checkDayOfReminders(): Promise<number> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const pendingBookings = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "scheduled"),
        eq(schema.bookings.reminderDayOfSent, false),
        gte(schema.bookings.scheduledAt, oneHourAgo),
        lte(schema.bookings.scheduledAt, inTwoHours),
      ),
    );

  let count = 0;

  for (const booking of pendingBookings) {
    const [lead] = await db
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, booking.leadId))
      .limit(1);

    if (!lead) continue;

    const meetingTime = booking.scheduledAt.toLocaleString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const joinLink = booking.meetingUrl || "Join link will be shared shortly";

    const waId = await sendWhatsAppReminder(lead.phoneE164, "meeting_reminder_day_of", [
      lead.firstName || "there",
      meetingTime,
      joinLink,
    ]);

    if (waId) {
      await db
        .update(schema.bookings)
        .set({ reminderDayOfSent: true })
        .where(eq(schema.bookings.id, booking.id));

      await db.insert(schema.messages).values({
        id: randomUUID(),
        leadId: booking.leadId,
        clientId: booking.clientId,
        callId: booking.callId,
        channel: "whatsapp",
        direction: "outbound",
        body: `Day-of reminder sent — meeting starting at ${meetingTime}`,
        waMessageId: waId,
        templateName: "meeting_reminder_day_of",
      });

      count++;
    }
  }

  return count;
}

export async function checkNoShows(): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const missedBookings = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "scheduled"),
        eq(schema.bookings.reminderDayOfSent, true),
        lt(schema.bookings.scheduledAt, oneHourAgo),
      ),
    );

  let count = 0;

  for (const booking of missedBookings) {
    await db
      .update(schema.bookings)
      .set({ status: "no_show" })
      .where(eq(schema.bookings.id, booking.id));

    count++;
  }

  return count;
}
