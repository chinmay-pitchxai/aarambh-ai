import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { getSession } from "@/backend/auth";
import { VobizClient, VobizApiError } from "@/backend/integrations/vobiz";
import { serverConfig } from "@/backend/config";

// Map Vobiz / network failures to friendly, actionable messages.
function friendlyError(err: unknown): { message: string; status: number } {
  if (err instanceof VobizApiError) {
    switch (err.vobizError.status) {
      case 401:
        return { message: "Auth ID or Auth Token is incorrect. Check https://console.vobiz.ai", status: 401 };
      case 403:
        return { message: "Your Vobiz account doesn't have permission for this API key", status: 403 };
      case 404:
        return { message: "Account not found for this Auth ID", status: 404 };
      default:
        return { message: `Vobiz API error: ${err.message}`, status: 502 };
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  const isNetwork = /fetch failed|ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|ECONNRESET|timed? ?out/i.test(message);
  if (isNetwork) {
    return { message: "Cannot reach api.vobiz.ai — check your internet/VPN", status: 502 };
  }
  return { message: `Unexpected error: ${message}`, status: 500 };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { authId, authToken } = body;

    if (!authId || !authToken) {
      return NextResponse.json({ error: "authId and authToken are required" }, { status: 400 });
    }

    const client = new VobizClient({ authId, authToken });

    // Thorough validation: hits the account numbers endpoint (surfaces 401/403/404/
    // network distinctly) AND reads balance (best-effort).
    let balance;
    try {
      balance = await client.verifyCredentials();
    } catch (err) {
      const { message, status } = friendlyError(err);
      return NextResponse.json({ error: message, connected: false }, { status });
    }

    // Register webhook best-effort — must NEVER break connect.
    const webhookUrl = `${serverConfig.appUrl}/api/v1/webhooks/vobiz`;
    let webhook;
    try {
      webhook = await client.registerWebhook(webhookUrl);
    } catch (err) {
      console.error("[vobiz connect] webhook registration failed:", err);
      webhook = {
        configured: false,
        url: webhookUrl,
        message: "webhook auto-registration failed (non-fatal)",
      };
    }

    const credentialsEncrypted = JSON.stringify({
      authId,
      authToken,
      webhookUrl,
      webhookConfigured: webhook.configured,
    });

    await db
      .insert(schema.integrationCredentials)
      .values({
        tenantId: session.activeOrganizationId,
        integration: "vobiz",
        credentialsEncrypted,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [schema.integrationCredentials.tenantId, schema.integrationCredentials.integration],
        set: {
          credentialsEncrypted,
          status: "active",
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      connected: true,
      balance: balance ? { amount: balance.balance, currency: balance.currency } : null,
      webhookConfigured: webhook.configured,
      webhookUrl,
      webhookMessage: webhook.message,
    });
  } catch (err) {
    console.error("Vobiz connect error:", err);
    return NextResponse.json({ error: "Failed to connect to Vobiz" }, { status: 500 });
  }
}