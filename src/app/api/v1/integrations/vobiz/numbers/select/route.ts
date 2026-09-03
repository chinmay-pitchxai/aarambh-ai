import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { getSession } from "@/backend/auth";
import { eq, and } from "drizzle-orm";
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

    await db
      .insert(schema.phoneNumbers)
      .values({
        id: nanoid(),
        numberE164,
        provider: "vobiz",
        status: "active",
        tenantId: session.activeOrganizationId,
        assignedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.phoneNumbers.numberE164,
        set: {
          status: "active",
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
