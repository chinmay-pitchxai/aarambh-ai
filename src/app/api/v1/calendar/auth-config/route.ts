import { NextResponse } from "next/server";
import { requireAuth } from "@/backend/auth/middleware";
import { composioService } from "@/backend/integrations/composio";

// ── Create the Google Calendar Composio auth config (v1) ──
// POST /api/v1/calendar/auth-config — creates the GOOGLECALENDAR auth config
// with Composio Managed OAuth if none exists, so the user can then connect
// their Google account from the Connections page in one click.

export async function POST() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const result = await composioService.ensureCalendarAuthConfig();
    return NextResponse.json({
      ...result,
      message: result.created
        ? "Google Calendar auth config created. Now connect your Google account from the Connections page."
        : "Google Calendar auth config already exists. Connect your Google account from the Connections page.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
