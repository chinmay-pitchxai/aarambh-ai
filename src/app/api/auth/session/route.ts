import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/backend/auth";
import { db, schema } from "@/backend/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const org = await db.query.organizations.findFirst({
      where: eq(schema.organizations.id, session.activeOrganizationId),
    });

    return NextResponse.json({
      user: { id: session.userId, email: session.email },
      org: org ? {
        id: org.id,
        name: org.name,
        onboardingCompleted: Boolean(org.onboardingCompletedAt),
      } : null,
    });
  } catch (error) {
    console.error("[auth/session]", error);
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
