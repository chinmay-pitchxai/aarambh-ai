import { NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { db, schema } from "@/backend/db";
import { eq, and } from "drizzle-orm";
import { VobizClient } from "@/backend/integrations/vobiz";
import { serverConfig } from "@/backend/config";

// ── Vobiz connection diagnostics (v1) ──
// GET /api/v1/integrations/vobiz/status — safe, read-only probe.
// Resolves the tenant's saved Vobiz credentials (+ assigned caller-ID number)
// incrementally so per-tenant connect flows report correctly; falls back to
// global env credentials when the tenant has not connected yet.
// Reports DNS → API reachability → credential validity → balance/numbers.

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;
  const tenantId = auth.ctx.tenantId;

  let client: VobizClient | null = null;
  let fromEnv = false;
  let selectedNumber: string | null = null;

  const [cred] = await db
    .select()
    .from(schema.integrationCredentials)
    .where(
      and(
        eq(schema.integrationCredentials.tenantId, tenantId),
        eq(schema.integrationCredentials.integration, "vobiz"),
      ),
    )
    .limit(1);

  let envClient: VobizClient | null = null;
  if (cred?.credentialsEncrypted) {
    const creds = JSON.parse(cred.credentialsEncrypted) as { authId?: string; authToken?: string };
    if (creds.authId && creds.authToken) {
      client = new VobizClient({ authId: creds.authId, authToken: creds.authToken });
    }
  } else {
    if (serverConfig.vobiz.authId && serverConfig.vobiz.authToken) {
      envClient = new VobizClient({ authId: serverConfig.vobiz.authId, authToken: serverConfig.vobiz.authToken });
      client = envClient;
      fromEnv = true;
    }
  }

  const [assigned] = await db
    .select({ numberE164: schema.phoneNumbers.numberE164 })
    .from(schema.phoneNumbers)
    .where(
      and(
        eq(schema.phoneNumbers.tenantId, tenantId),
        eq(schema.phoneNumbers.status, "assigned"),
      ),
    )
    .limit(1);
  selectedNumber = assigned?.numberE164 || null;

  if (!client) {
    return NextResponse.json({
      connected: false,
      error: "Vobiz is not connected. Add Auth ID + Auth Token from console.vobiz.ai.",
      setup: "Add VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN from the Vobiz Console (https://console.vobiz.ai), plus VOBIZ_FROM_NUMBER (your caller-ID number).",
      fromEnv,
      selectedNumber,
    });
  }

  const health = await client.healthCheck();

  if (!health.ok) {
    return NextResponse.json({
      connected: false,
      ...health,
      fromEnv,
      selectedNumber,
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
    fromEnv,
    selectedNumber,
    balance,
    hasProvisionedNumber: Array.isArray(numbers) && numbers.length > 0,
    capabilities: client.capabilities,
  });
}