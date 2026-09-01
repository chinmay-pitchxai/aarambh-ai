import { NextResponse } from "next/server";
import { createUser, findUserByEmail, createSession } from "@/backend/auth";

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const { userId, orgId } = await createUser(email, password, name);
    await createSession(userId);

    return NextResponse.json({
      user: { id: userId, email, name: name || email.split("@")[0] },
      org: { id: orgId },
    });
  } catch (error) {
    console.error("[auth/signup]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
