import { NextResponse } from "next/server";
import { getActivePlans } from "@/backend/billing/plans";

export async function GET() {
  return NextResponse.json({ plans: getActivePlans() });
}