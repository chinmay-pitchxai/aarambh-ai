import { NextRequest, NextResponse } from "next/server";
import { composioService } from "@/backend/integrations/composio";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const integration = searchParams.get("integration");
  const connectedAccountId = searchParams.get("connectedAccountId") || searchParams.get("connected_account_id");
  const status = searchParams.get("status") || "active";
  const error = searchParams.get("error");
  const appName = searchParams.get("appName") || searchParams.get("app_name") || "";

  if (!clientId || !integration) {
    return NextResponse.redirect(new URL("/connections?error=missing_params", req.url));
  }

  if (error) {
    return NextResponse.redirect(
      new URL("/connections?error=" + encodeURIComponent(error), req.url)
    );
  }

  if (!connectedAccountId) {
    return NextResponse.redirect(
      new URL("/connections?error=no_account_id", req.url)
    );
  }

  try {
    const result = await composioService.handleCallback({
      clientId,
      integration,
      connectedAccountId,
      status,
    });

    if (result.success) {
      return NextResponse.redirect(
        new URL("/connections?connected=" + integration, req.url)
      );
    } else {
      return NextResponse.redirect(
        new URL("/connections?error=" + encodeURIComponent(result.error || "callback_failed"), req.url)
      );
    }
  } catch (err: any) {
    console.error("Callback error:", err);
    return NextResponse.redirect(
      new URL("/connections?error=" + encodeURIComponent(err.message), req.url)
    );
  }
}
