import { NextRequest, NextResponse } from "next/server";
import { composio2Service } from "@/backend/integrations/composio2";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const integration = searchParams.get("integration");
  const connectedAccountId =
    searchParams.get("connected_account_id") ||
    searchParams.get("connectedAccountId") ||
    "";
  const status = searchParams.get("status") || undefined;

  if (!clientId || !integration) {
    return NextResponse.redirect(
      new URL("/connections?error=Missing+callback+parameters", req.url),
    );
  }

  try {
    if (connectedAccountId) {
      await composio2Service.handleCallback({
        clientId,
        integration,
        connectedAccountId,
        status,
      });
    }

    const redirectUrl = new URL("/connections", req.url);
    redirectUrl.searchParams.set("connected", integration);
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    console.error("[composio2/callback] error:", err);
    const redirectUrl = new URL("/connections", req.url);
    redirectUrl.searchParams.set(
      "error",
      encodeURIComponent(err instanceof Error ? err.message : "Callback failed"),
    );
    return NextResponse.redirect(redirectUrl);
  }
}