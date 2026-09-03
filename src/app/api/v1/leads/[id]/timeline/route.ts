import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/backend/auth";
import { getLeadTimeline } from "@/backend/services/lead-timeline";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const leadId = params.id;
  const tenantId = session.activeOrganizationId;

  try {
    const timeline = await getLeadTimeline(tenantId, leadId);
    return NextResponse.json({ leadId, timeline });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load timeline";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
