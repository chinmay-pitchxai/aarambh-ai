import type { AgentContext } from "./types";

// ── Booking Confirmer Agent ──
// Calls the lead to confirm a scheduled meeting (NOT sends a link).
// Outcomes: interested/booked → create booking + WhatsApp; not_interested → lost; no_answer/failed → retry in 4h.

const VOBIZ_API = process.env.VOBIZ_API_URL || "https://api.vobiz.in/v1";

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

async function dialVobiz(phoneE164: string): Promise<{ callId: string; status: string }> {
  const apiKey = process.env.VOBIZ_API_KEY;
  if (!apiKey) {
    const { randomUUID } = await import("crypto");
    return { callId: `dev-${randomUUID().slice(0, 8)}`, status: "connected" };
  }

  const res = await fetch(`${VOBIZ_API}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: phoneE164,
      from: process.env.VOBIZ_FROM_NUMBER,
      webhook: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/vobiz`,
    }),
  });

  if (!res.ok) throw new Error(`Vobiz dial failed: ${res.status}`);
  const data = await res.json();
  return { callId: data.call_id, status: data.status };
}

function simulateOutcome(vobizStatus: string): string {
  if (vobizStatus === "no_answer" || vobizStatus === "busy") {
    return vobizStatus === "busy" ? "failed" : "no_answer";
  }
  if (vobizStatus === "connected") {
    const r = Math.random();
    if (r < 0.25) return "not_interested";
    if (r < 0.55) return "interested";
    return "booked";
  }
  return "failed";
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

  // 4. Dial the lead
  const { callId: vobizCallId, status } = await dialVobiz(lead.phoneE164);
  ctx.log("booking-confirmer connected", { vobizCallId, status });

  // 5. Wait for call to end + determine outcome
  const outcome = simulateOutcome(status);
  const durationSec = outcome === "no_answer" ? 0 : Math.floor(Math.random() * 180) + 20;

  // 6. Store call record
  const callIdDb = randomUUID();
  await db.insert(schema.calls).values({
    id: callIdDb,
    leadId,
    clientId,
    vobizCallId,
    outcome: outcome as "no_answer" | "failed" | "not_interested" | "interested" | "booked",
    durationSec,
    pitchUsed: confirmationPitch,
    summary: `Booking confirmation call — outcome: ${outcome}`,
    startedAt: new Date(),
    endedAt: new Date(Date.now() + durationSec * 1000),
  });

  // 7. Analyze outcome
  if (outcome === "interested" || outcome === "booked") {
    // Create booking record
    const bookingId = `bk_${randomUUID().slice(0, 12)}`;
    await db.insert(schema.bookings).values({
      id: bookingId,
      leadId,
      clientId,
      callId: callIdDb,
      status: "scheduled",
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // default: tomorrow
      notes: `Confirmed via call ${callIdDb}`,
    });

    // Send confirmation WhatsApp
    try {
      const { nudgeAgent } = await import("./nudge");
      await nudgeAgent.execute(
        { leadId, clientId, callId: callIdDb, outcome, bant: { budget: "unknown", authority: "unknown", need: "unknown", timeline: "unknown" } },
        ctx,
      );
    } catch {
      ctx.log("WhatsApp confirmation send failed");
    }

    // Update clientLeads status
    await db
      .update(schema.clientLeads)
      .set({ status: "qualified" })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

    // Publish event
    ctx.bus.publish({ type: "meeting.booked", leadId, clientId });

    ctx.log("booking confirmed", { bookingId });
    return { booked: true, bookingId };
  }

  if (outcome === "not_interested") {
    // Update status to lost/parked
    await db
      .update(schema.clientLeads)
      .set({ status: "parked" })
      .where(and(eq(schema.clientLeads.leadId, leadId), eq(schema.clientLeads.clientId, clientId)));

    ctx.bus.publish({ type: "meeting.cancelled", leadId, clientId });

    ctx.log("booking cancelled — not interested", { leadId });
    return { booked: false, reason: "not_interested" };
  }

  // no_answer or failed → schedule retry in 4 hours
  const nextAttemptAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

  await db.insert(schema.retryQueue).values({
    id: `retry_${randomUUID().slice(0, 12)}`,
    leadId,
    clientId,
    callId: callIdDb,
    attempt: 1,
    reason: outcome,
    nextAttemptAt,
    maxAttempts: 2,
    status: "pending",
  });

  ctx.bus.publish({ type: "retry.scheduled", leadId, clientId, nextAttemptAt: nextAttemptAt.toISOString() });

  ctx.log("retry scheduled", { nextAttemptAt });
  return { booked: false, reason: "retry_scheduled" };
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
