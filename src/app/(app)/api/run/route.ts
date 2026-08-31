import { NextRequest, NextResponse } from "next/server";
import { createPipeline } from "@/backend/agents";
import { scoutAgent } from "@/backend/agents/scout";
import { rankerAgent } from "@/backend/agents/ranker";
import { consentAgent } from "@/backend/agents/consent";
import { dialerAgent } from "@/backend/agents/dialer";
import { nudgeAgent } from "@/backend/agents/nudge";


export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { clientId, icpTags, batchSize } = body as {
    clientId?: string;
    icpTags?: unknown;
    batchSize?: unknown;
  };

  if (!clientId || typeof clientId !== "string" || clientId.trim().length === 0) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  if (!Array.isArray(icpTags) || icpTags.length === 0 || !icpTags.every((t) => typeof t === "string")) {
    return NextResponse.json({ error: "icpTags must be non-empty string array" }, { status: 400 });
  }

  const size = typeof batchSize === "number" && Number.isFinite(batchSize) ? Math.min(100, Math.max(1, Math.floor(batchSize))) : 50;

  const pipeline = createPipeline({
    agents: {
      consent: consentAgent,
      dialer: dialerAgent,
      nudge: nudgeAgent,
    },
  });

  // 1. Scout: pull leads
  const scoutResult = await scoutAgent.execute(
    { clientId, icpTags, batchSize: size },
    { leadId: "", clientId, bus: pipeline.bus, store: pipeline.store, log: console.log },
  );

  // 2. Ranker: score leads
  if (scoutResult.leadIds.length > 0) {
    await rankerAgent.execute(
      { leadIds: scoutResult.leadIds, clientId },
      { leadId: "", clientId, bus: pipeline.bus, store: pipeline.store, log: console.log },
    );
  }

  // 3. Run per-lead pipeline: Consent → Dialer → Nudge → Outcome Router
  const results = await pipeline.runBatch(scoutResult.leadIds, clientId);

  return NextResponse.json({
    scout: scoutResult,
    pipeline: results,
    summary: {
      total: results.length,
      booked: results.filter((r) => r.stage === "booked").length,
      retry: results.filter((r) => r.stage === "retry").length,
      parked: results.filter((r) => r.stage === "parked").length,
      dlq: results.filter((r) => r.stage === "dlq").length,
    },
  });
}
