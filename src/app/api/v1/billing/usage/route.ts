import { NextResponse } from "next/server";
import { db } from "@/backend/db";
import { requireAuth } from "@/backend/auth/middleware";
import { checkEntitlement, USAGE_RESOURCES, NoActiveSubscriptionError } from "@/backend/billing/entitlements";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  try {
    const usage = [];
    for (const resource of USAGE_RESOURCES) {
      usage.push(await checkEntitlement(db, auth.ctx.tenantId, resource));
    }
    return NextResponse.json({ usage });
  } catch (error) {
    if (error instanceof NoActiveSubscriptionError) {
      return NextResponse.json({ subscription: null, usage: [] });
    }
    console.error("[api/v1/billing/usage]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}