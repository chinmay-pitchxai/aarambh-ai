import { NextRequest, NextResponse } from "next/server";
import Redis from "ioredis";
import { requireRole } from "@/backend/auth/middleware";
import { db } from "@/backend/db";
import { schema } from "@/backend/db";
import { eq, and } from "drizzle-orm";
import { initiateCall } from "@/backend/telephony/call-engine";
import { createDurableQueue } from "@/backend/queue/durable-queue";

// ── Initiate Call API ──
// POST /api/v1/calls/initiate
// Body: { leadId: string }
// Enqueues a call job to the durable queue. The call-worker picks it up
// and routes through Gemini Live voice agent when available.

export async function POST(req: NextRequest) {
  const auth = await requireRole("member");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { leadId } = body as { leadId?: string };

  if (!leadId || typeof leadId !== "string" || leadId.trim().length === 0) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }

  // Verify the lead belongs to this tenant
  const [clientLead] = await db
    .select({ id: schema.clientLeads.id, leadId: schema.clientLeads.leadId })
    .from(schema.clientLeads)
    .where(
      and(
        eq(schema.clientLeads.leadId, leadId),
        eq(schema.clientLeads.clientId, auth.ctx.tenantId),
      ),
    )
    .limit(1);

  if (!clientLead) {
    return NextResponse.json({ error: "Lead not found for this tenant" }, { status: 404 });
  }

  // Check lead has a phone number
  const [lead] = await db
    .select({ phoneE164: schema.leads.phoneE164 })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1);

  if (!lead || !lead.phoneE164) {
    return NextResponse.json({ error: "Lead has no phone number" }, { status: 400 });
  }

  // Get tenant's phone number for caller ID
  const [phoneNumber] = await db
    .select({ numberE164: schema.phoneNumbers.numberE164 })
    .from(schema.phoneNumbers)
    .where(
      and(
        eq(schema.phoneNumbers.tenantId, auth.ctx.tenantId),
        eq(schema.phoneNumbers.status, "available"),
      ),
    )
    .limit(1);

  if (!phoneNumber) {
    return NextResponse.json(
      { error: "No phone number provisioned for this tenant. Provision one first." },
      { status: 400 },
    );
  }

  try {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
      connectTimeout: 2000,
      lazyConnect: true,
    });
    const queue = createDurableQueue(redis, "call-init");

    const result = await initiateCall(db, queue, {
      tenantId: auth.ctx.tenantId,
      leadId,
      fromNumber: phoneNumber.numberE164,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      callQueued: true,
      jobId: result.jobId,
      leadId,
      fromNumber: phoneNumber.numberE164,
      toNumber: lead.phoneE164,
    }, { status: 202 });
  } catch (err) {
    console.error("[api/v1/calls/initiate] POST error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
