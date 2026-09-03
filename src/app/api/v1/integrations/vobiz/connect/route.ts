import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { getSession } from "@/backend/auth";
import { VobizClient, VobizApiError } from "@/backend/integrations/vobiz";


export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { authId, authToken } = body;

    if (!authId || !authToken) {
      return NextResponse.json({ error: "authId and authToken are required" }, { status: 400 });
    }

    const client = new VobizClient({ authId, authToken });

    let balance;
    try {
      balance = await client.getBalance();
    } catch (err) {
      if (err instanceof VobizApiError && err.vobizError.status === 401) {
        return NextResponse.json({ error: "Invalid credentials — Auth ID or Auth Token is incorrect" }, { status: 401 });
      }
      throw err;
    }

    await db
      .insert(schema.integrationCredentials)
      .values({
        tenantId: session.activeOrganizationId,
        integration: "vobiz",
        credentialsEncrypted: JSON.stringify({ authId, authToken }),
        status: "active",
      })
      .onConflictDoUpdate({
        target: [schema.integrationCredentials.tenantId, schema.integrationCredentials.integration],
        set: {
          credentialsEncrypted: JSON.stringify({ authId, authToken }),
          status: "active",
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      connected: true,
      balance: balance ? { amount: balance.balance, currency: balance.currency } : null,
    });
  } catch (err) {
    console.error("Vobiz connect error:", err);
    return NextResponse.json({ error: "Failed to connect to Vobiz" }, { status: 500 });
  }
}
