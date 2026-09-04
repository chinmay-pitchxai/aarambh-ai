import type { AgentContext } from "./types";
import { serverConfig } from "../config";
import { getTenantVobizConfig } from "../telephony/tenant-telephony";

// ── Booking Confirmer Agent ──
// Calls the lead to confirm a scheduled meeting (NOT sends a link).
// Submits a REAL call through Vobiz. The terminal outcome arrives via the
// provider status/hangup callback and is routed by the outcome router, which
// owns booking creation. This agent NEVER fabricates call outcomes and NEVER
// creates bookings from anything but a confirmed provider outcome.

async function dialVobiz(phoneE164: string, clientId: string): Promise<{ callId: string; status: string }> {
  const { db, schema } = await import("../db");
  const { client, fromNumber } = await getTenantVobizConfig(db, clientId);
  const answerUrl = `${serverConfig.appUrl}/api/v1/webhooks/vobiz`;
  const result = await client.initiateCall(fromNumber, phoneE164, answerUrl, {
    timeout: 30,
    callbackUrl: answerUrl,
  });
  return { callId: result.callId, status: result.status };
}

interface ConfirmBookingInput {
  leadId: string;
  clientId: string;
  callId?: string;
}

interface ConfirmBookingResult {
  booked: boolean;
  bookingId?: string;
  reason?: string;
}

interface BookingRecord {
  id: string;
  leadId: string;
  clientId: string;
  callId: string | null;
  status: string;
  scheduledAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

export async function confirmBooking(
  input: ConfirmBookingInput,
  ctx: AgentContext,
): Promise<ConfirmBookingResult> {
  const { leadId, clientId } = input;
  ctx.log("booking-confirmer start", { leadId });

  const { db, schema } = await import("../db");
  const { eq, and, gt, asc } = await import("drizzle-orm");
  const { randomUUID } = await import("crypto");

  // 1. Fetch lead
  const [lead] = await db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (!lead.phoneE164) throw new Error(`No phone for lead ${leadId}`);

  // 2. Fetch last call for context
  const [lastCall] = await db
    .select()
    .from(schema.calls)
    .where(eq(schema.calls.leadId, leadId))
    .orderBy(schema.calls.startedAt)
    .limit(1);

  // 3. Generate confirmation pitch via LLM
  const callContext = lastCall?.summary
    ? `Previous call summary: ${lastCall.summary}`
    : "This is a follow-up call.";

  const pitchPrompt = `You are calling to confirm a meeting. The lead showed interest in our product.
Be professional, confirm the meeting time, and provide details.
Lead name: ${lead.firstName || "there"} ${lead.lastName || ""}.
${callContext}
Keep it under 30 seconds. Speak naturally and warmly.`;

  let confirmationPitch: string;
  try {
    const { llmLabAgent } = await import("./llm-lab");
    const llmResult = await llmLabAgent.execute(
      { action: "generate_pitch", previousContext: pitchPrompt },
      ctx,
    );
    confirmationPitch = llmResult.pitch || pitchPrompt;
  } catch {
    ctx.log("LLM pitch generation failed, using default");
    confirmationPitch = `Hi ${lead.firstName || "there"}, this is a quick call to confirm your upcoming meeting. Do you have a moment?`;
  }

  // 4. Submit the real confirmation call. The terminal outcome arrives via
  // the provider status/hangup callback and is routed by the outcome router,
  // which owns booking creation. Never book from a guessed outcome.
  const { callId: vobizCallId, status } = await dialVobiz(lead.phoneE164, clientId);
  ctx.log("booking-confirmer submitted real call", { vobizCallId, status });

  // 5. Store pending call record (outcome filled in by webhook flow)
  const callIdDb = randomUUID();
  await db.insert(schema.calls).values({
    id: callIdDb,
    leadId,
    clientId,
    vobizCallId,
    outcome: null,
    durationSec: null,
    pitchUsed: confirmationPitch,
    summary: `Booking confirmation call submitted (provider uuid ${vobizCallId}). Awaiting provider outcome via webhook.`,
    startedAt: new Date(),
  });

  ctx.log("confirmation call submitted — outcome pending via webhook", { callIdDb });
  return { booked: false, reason: "call_submitted" };
}

export async function getUpcomingBookings(
  clientId: string,
  limit = 20,
): Promise<BookingRecord[]> {
  const { db, schema } = await import("../db");
  const { eq, and, gt, asc } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.clientId, clientId),
        eq(schema.bookings.status, "scheduled"),
        gt(schema.bookings.scheduledAt, new Date()),
      ),
    )
    .orderBy(asc(schema.bookings.scheduledAt))
    .limit(limit);

  return rows as BookingRecord[];
}

export async function updateBookingStatus(
  bookingId: string,
  status: "scheduled" | "completed" | "cancelled" | "no_show",
  ctx: AgentContext,
): Promise<void> {
  const { db, schema } = await import("../db");
  const { eq } = await import("drizzle-orm");

  const [booking] = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);

  if (!booking) throw new Error(`Booking ${bookingId} not found`);

  await db
    .update(schema.bookings)
      .set({ status })
      .where(eq(schema.bookings.id, bookingId));

  if (status === "completed") {
    ctx.bus.publish({ type: "meeting.completed", leadId: booking.leadId, clientId: booking.clientId });
  } else if (status === "cancelled") {
    ctx.bus.publish({ type: "meeting.cancelled", leadId: booking.leadId, clientId: booking.clientId });
  } else if (status === "no_show") {
    ctx.bus.publish({ type: "meeting.no_show", leadId: booking.leadId, clientId: booking.clientId });
  }

  ctx.log("booking status updated", { bookingId, status });
}
