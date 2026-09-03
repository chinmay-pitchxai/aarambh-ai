import { NextResponse } from "next/server";
import { findUserByEmail, verifyPassword, createSession } from "@/backend/auth";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const user = await findUserByEmail(email);
    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, name: user.name },
    });

    // Clear any stale session cookies before creating new one
    response.cookies.set("session", "", { maxAge: 0, path: "/" });

    await createSession(user.id);

    return response;
  } catch (error) {
    console.error("[auth/login]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
