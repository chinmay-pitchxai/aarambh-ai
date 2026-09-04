import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { getSession } from "@/backend/auth";
import { VobizClient } from "@/backend/integrations/vobiz";
import { eq, and } from "drizzle-orm";
import { nanoid } from "@/backend/auth/nanoid";

export async function GET(_req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [cred] = await db
      .select()
      .from(schema.integrationCredentials)
      .where(
        and(
          eq(schema.integrationCredentials.tenantId, session.activeOrganizationId),
          eq(schema.integrationCredentials.integration, "vobiz"),
        )
      );

    if (!cred || !cred.credentialsEncrypted) {
      return NextResponse.json({ error: "Vobiz not connected" }, { status: 400 });
    }

    const creds = JSON.parse(cred.credentialsEncrypted) as { authId: string; authToken: string };
    const client = new VobizClient({ authId: creds.authId, authToken: creds.authToken });

    const numbers = await client.listAccountNumbers();

    let selectedNumber: string | null = null;

    if (numbers.length === 1) {
      const num = numbers[0];
      await db
        .insert(schema.phoneNumbers)
        .values({
          id: nanoid(),
          numberE164: num.e164,
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
      selectedNumber = num.e164;
    }

    return NextResponse.json({
      numbers: numbers.map((n) => ({ id: n.id, e164: n.e164, status: n.status, voiceEnabled: n.voiceEnabled, region: n.region })),
      selectedNumber,
      allowManual: numbers.length === 0,
    });
  } catch (err) {
    console.error("Vobiz numbers error:", err);
    return NextResponse.json({ error: "Failed to fetch numbers" }, { status: 500 });
  }
}
