import { NextRequest, NextResponse } from "next/server";
import { composio2Service } from "@/backend/integrations/composio2";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const integration = searchParams.get("integration");
  const clientId = searchParams.get("clientId");

  if (!action) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  if (action !== "integrations" && (!integration || !clientId)) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const safeClientId = clientId || "";
  const safeIntegration = integration || "";

  try {
    switch (action) {
      case "connect": {
        const baseUrl = req.nextUrl.origin;
        const callbackUrl = `${baseUrl}/api/composio2/callback?clientId=${encodeURIComponent(safeClientId)}&integration=${encodeURIComponent(safeIntegration)}`;

        const result = await composio2Service.initiateConnection(safeClientId, safeIntegration, callbackUrl);

        if (result.needsConfig) {
          return NextResponse.json({
            success: false,
            needsConfig: true,
            error: result.error,
          });
        }

        if (result.alreadyConnected) {
          return NextResponse.json({
            success: true,
            alreadyConnected: true,
          });
        }

        if (result.redirectUrl) {
          return NextResponse.json({
            success: true,
            needsAuth: true,
            authUrl: result.redirectUrl,
            connectedAccountId: result.connectedAccountId,
          });
        }

        return NextResponse.json({
          success: false,
          error: result.error || "Failed to create connection link",
        });
      }

      case "status": {
        const connection = await composio2Service.getConnectionStatus(safeClientId, safeIntegration);
        return NextResponse.json({
          connected: connection?.connected ?? false,
          status: connection?.status,
          accountEmail: connection?.accountEmail,
          composioAccountId: connection?.composioAccountId,
          lastSyncedAt: connection?.lastSyncedAt,
        });
      }

      case "integrations": {
        const integrations = await composio2Service.getAvailableIntegrations();
        return NextResponse.json({ integrations });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Composio2 API error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, integration, clientId } = body;

    if (!action || !integration || !clientId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    if (action === "disconnect") {
      const result = await composio2Service.disconnectIntegration(clientId, integration);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Composio2 POST error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}