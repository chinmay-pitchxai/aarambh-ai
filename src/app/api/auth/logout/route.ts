import { NextResponse } from "next/server";
import { deleteSession } from "@/backend/auth";

export async function POST() {
  try {
    await deleteSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[auth/logout]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
