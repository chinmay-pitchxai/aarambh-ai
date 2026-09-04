import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { composio2Service } from "@/backend/integrations/composio2";

export type CalendarStatusAction = "connect" | "reconnect" | "create-auth-config" | "ok";

// GET /api/v1/calendar/status — Google Calendar connection state for the tenant,
// plus an actionable `action` field and a human-readable message so the UI can
// guide the user (connect vs reconnect vs create the Composio auth config).
export async function GET(_req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const state = await composio2Service.getCalendarConnectionState(auth.ctx.tenantId);

    let action: CalendarStatusAction;
    let message: string;
    if (!state.authConfigExists) {
      action = "create-auth-config";
      message =
        "No Google Calendar auth config exists in Composio yet. Create one with Composio Managed Auth (toolkit GOOGLECALENDAR), then connect your Google account from the Connections page.";
    } else if (state.connected) {
      action = "ok";
      message = state.accountEmail
        ? `Google Calendar is connected as ${state.accountEmail}.`
        : "Google Calendar is connected.";
    } else if (state.status && state.status !== "pending") {
      action = "reconnect";
      message = `Your Google Calendar connection is ${state.status} (likely expired). Please reconnect from the Connections page.`;
    } else {
      action = "connect";
      message =
        "Google Calendar is not connected. Start the OAuth flow from the Connections page.";
    }

    return NextResponse.json({ ...state, action, message });
  } catch (err) {
    console.error("[api/v1/calendar/status] GET error", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
