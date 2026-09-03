import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { getDueCallbacks } from "./lead-memory";
import { VobizClient } from "../integrations/vobiz";

export async function processCallbacks(tenantId: string): Promise<{ initiated: number; skipped: number }> {
  const dueMemories = await getDueCallbacks(tenantId);
  let initiated = 0;
  let skipped = 0;

  for (const memory of dueMemories) {
    try {
      const [lead] = await db
        .select({ phoneE164: schema.leads.phoneE164 })
        .from(schema.leads)
        .where(eq(schema.leads.id, memory.leadId))
        .limit(1);

      if (!lead?.phoneE164) { skipped++; continue; }

      const [phoneNumber] = await db
        .select({ numberE164: schema.phoneNumbers.numberE164 })
        .from(schema.phoneNumbers)
        .where(and(eq(schema.phoneNumbers.tenantId, tenantId), eq(schema.phoneNumbers.status, "assigned")))
        .limit(1);

      if (!phoneNumber) { skipped++; continue; }

      const [cred] = await db
        .select()
        .from(schema.integrationCredentials)
        .where(and(
          eq(schema.integrationCredentials.tenantId, tenantId),
          eq(schema.integrationCredentials.integration, "vobiz"),
          eq(schema.integrationCredentials.status, "active"),
        ))
        .limit(1);

      if (!cred?.credentialsEncrypted) { skipped++; continue; }

      const creds = JSON.parse(cred.credentialsEncrypted);
      const client = new VobizClient({
        authId: creds.authId,
        authToken: creds.authToken,
        fromNumber: phoneNumber.numberE164,
      });

      const answerUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/v1/webhooks/vobiz`;

      await client.initiateCall(phoneNumber.numberE164, lead.phoneE164, answerUrl, {
        timeout: 30,
        callbackUrl: answerUrl,
      });

      initiated++;
    } catch (error) {
      console.error("[callback-scheduler] failed to initiate callback", error);
      skipped++;
    }
  }

  return { initiated, skipped };
}
