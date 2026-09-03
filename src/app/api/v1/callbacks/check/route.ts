import { NextResponse } from "next/server";
import { getSession } from "@/backend/auth";
import { processCallbacks } from "@/backend/services/callback-scheduler";

export async function POST() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await processCallbacks(session.activeOrganizationId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to process callbacks" }, { status: 500 });
  }
}
