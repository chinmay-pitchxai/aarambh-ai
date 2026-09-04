import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { getSession } from "@/backend/auth";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "@/backend/auth/nanoid";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { numberE164 } = body as { numberE164?: string };

    if (!numberE164 || typeof numberE164 !== "string") {
      return NextResponse.json({ error: "numberE164 required" }, { status: 400 });
    }

    // A tenant has exactly ONE active outbound caller-ID: demote any previously
    // assigned Vobiz number before assigning the newly chosen one.
    await db
      .update(schema.phoneNumbers)
      .set({ status: "available", assignedAt: null })
      .where(
        and(
          eq(schema.phoneNumbers.tenantId, session.activeOrganizationId),
          eq(schema.phoneNumbers.provider, "vobiz"),
          eq(schema.phoneNumbers.status, "assigned"),
          sql`${schema.phoneNumbers.numberE164} != ${numberE164}`,
        ),
      );

    await db
      .insert(schema.phoneNumbers)
      .values({
        id: nanoid(),
        numberE164,
        provider: "vobiz",
        status: "assigned",
        tenantId: session.activeOrganizationId,
        assignedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.phoneNumbers.numberE164,
        set: {
          status: "assigned",
          tenantId: session.activeOrganizationId,
          assignedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true, selectedNumber: numberE164 });
  } catch (err) {
    console.error("Vobiz number select error:", err);
    return NextResponse.json({ error: "Failed to select number" }, { status: 500 });
  }
}
