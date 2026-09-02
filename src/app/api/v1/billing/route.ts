import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    billing: {
      plans: "/api/v1/billing/plans",
      subscription: "/api/v1/billing/subscription",
      wallet: "/api/v1/billing/wallet",
      usage: "/api/v1/billing/usage",
      webhook: "POST /api/v1/billing/webhook",
    },
  });
}