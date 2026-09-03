import { db, schema } from "../db";
import { eq, and, sql } from "drizzle-orm";

export interface TimelineEntry {
  id: string;
  type: "call" | "message" | "booking" | "status_change" | "retry";
  timestamp: Date;
  title: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export async function getLeadTimeline(
  tenantId: string,
  leadId: string,
): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];

  const calls = await db
    .select()
    .from(schema.calls)
    .where(and(eq(schema.calls.leadId, leadId), eq(schema.calls.clientId, tenantId)))
    .orderBy(sql`${schema.calls.startedAt} DESC`);

  for (const call of calls) {
    entries.push({
      id: call.id,
      type: "call",
      timestamp: call.startedAt ?? new Date(),
      title: `Call — ${call.outcome ?? "unknown"}`,
      summary: call.summary || `Duration: ${call.durationSec ?? 0}s. Outcome: ${call.outcome ?? "unknown"}.`,
      detail: {
        outcome: call.outcome,
        durationSec: call.durationSec,
        sentiment: call.sentiment,
        bant: call.bant,
        recordingUrl: call.recordingUrl,
        transcriptLength: Array.isArray(call.transcript) ? call.transcript.length : 0,
        attemptNumber: call.attemptNumber,
      },
    });
  }

  const messages = await db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.leadId, leadId), eq(schema.messages.clientId, tenantId)))
    .orderBy(sql`${schema.messages.sentAt} DESC`);

  for (const msg of messages) {
    entries.push({
      id: msg.id,
      type: "message",
      timestamp: msg.sentAt ?? new Date(),
      title: `${msg.direction === "inbound" ? "Inbound" : "Outbound"} ${msg.channel}`,
      summary: msg.body || `Message via ${msg.channel}`,
      detail: {
        channel: msg.channel,
        direction: msg.direction,
        templateName: msg.templateName,
      },
    });
  }

  const bookings = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.leadId, leadId), eq(schema.bookings.clientId, tenantId)))
    .orderBy(sql`${schema.bookings.scheduledAt} DESC`);

  for (const booking of bookings) {
    entries.push({
      id: booking.id,
      type: "booking",
      timestamp: booking.scheduledAt,
      title: `Meeting — ${booking.status}`,
      summary: `Scheduled for ${booking.scheduledAt.toISOString()} (${booking.durationMin ?? 30}min). Status: ${booking.status}.`,
      detail: {
        status: booking.status,
        durationMin: booking.durationMin,
        meetingUrl: booking.meetingUrl,
        notes: booking.notes,
      },
    });
  }

  const retries = await db
    .select()
    .from(schema.retryQueue)
    .where(and(eq(schema.retryQueue.leadId, leadId), eq(schema.retryQueue.clientId, tenantId)))
    .orderBy(sql`${schema.retryQueue.createdAt} DESC`);

  for (const retry of retries) {
    const isPending = retry.status === "pending";
    entries.push({
      id: retry.id,
      type: "retry",
      timestamp: retry.createdAt ?? new Date(),
      title: `Retry #${retry.attempt} — ${isPending ? "scheduled" : retry.status}`,
      summary: `Reason: ${retry.reason ?? "unknown"}. ${isPending ? `Next attempt: ${retry.nextAttemptAt?.toISOString() ?? "TBD"}` : `Status: ${retry.status}`}.`,
      detail: {
        attempt: retry.attempt,
        reason: retry.reason,
        nextAttemptAt: retry.nextAttemptAt,
        status: retry.status,
        maxAttempts: retry.maxAttempts,
      },
    });
  }

  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return entries;
}
