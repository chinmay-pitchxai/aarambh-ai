import { NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { getVobizClient } from "@/backend/integrations/vobiz";

// ── Vobiz connection diagnostics (v1) ──
// GET /api/v1/integrations/vobiz/status — safe, read-only probe.
// Reports DNS → API reachability → credential validity → balance/numbers,
// so the Connections page can show exactly what is missing.

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const client = getVobizClient();
  const health = await client.healthCheck();

  if (!health.ok) {
    return NextResponse.json({
      connected: false,
      ...health,
      capabilities: client.capabilities,
      setup: health.error?.includes("Missing credentials")
        ? "Add VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN from the Vobiz Console (https://console.vobiz.ai), plus VOBIZ_FROM_NUMBER (your caller-ID number)."
        : "Check that api.vobiz.ai is reachable and the credentials are correct.",
    });
  }

  const [balance, numbers] = await Promise.all([
    client.getBalance("INR").catch(() => null),
    client.listAccountNumbers(1, 1).catch(() => null),
  ]);

  return NextResponse.json({
    connected: true,
    ...health,
    balance,
    hasProvisionedNumber: Array.isArray(numbers) && numbers.length > 0,
    capabilities: client.capabilities,
  });
}
