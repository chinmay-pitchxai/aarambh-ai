import { NextResponse } from "next/server";
import { getSession, getUserOrganization } from "@/backend/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const org = await getUserOrganization(session.userId);

    return NextResponse.json({
      user: { id: session.userId, email: session.email },
      org: org ? { id: org.id, name: org.name } : null,
    });
  } catch (error) {
    console.error("[auth/session]", error);
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
