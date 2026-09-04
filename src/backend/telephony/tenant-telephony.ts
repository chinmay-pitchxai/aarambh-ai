import { db, schema } from "../db";
import { eq, and } from "drizzle-orm";
import { VobizClient } from "../integrations/vobiz";
import { serverConfig } from "../config";

// ── Tenant-scoped Telephony Resolution ──
// All outbound call paths resolve the caller-ID number and Vobiz credentials
// from the tenant's own records (integration_credentials + phone_numbers with
// status='assigned'), falling back to global env only when no tenant row exists.

export interface TenantVobizConfig {
  client: VobizClient;
  fromNumber: string;
  authId: string;
  authToken: string;
}

export interface TenantCallerId {
  fromNumber: string;
  client?: VobizClient;
  authId?: string;
  authToken?: string;
}

const ALLOWED_NUMBER_STATUS = "assigned";

/**
 * Load the tenant's Vobiz credentials and assigned caller-ID number from the DB.
 * Falls back to global env (VOBIZ_*) only when the tenant has no stored row,
 * so existing single-tenant deployments keep working. Throws a clear error when
 * neither a tenant config nor a usable env fallback exists.
 */
export async function getTenantVobizConfig(
  dbRef: any,
  tenantId: string,
): Promise<TenantVobizConfig> {
  const tenantConfig = await loadTenantVobiz(dbRef, tenantId);
  if (tenantConfig) return tenantConfig;

  const { authId, authToken, fromNumber, apiUrl } = serverConfig.vobiz;
  if (!authId || !authToken) {
    throw new Error(
      "Vobiz is not configured. Connect the tenant with Auth ID + Auth Token, or set VOBIZ_AUTH_ID and VOBIZ_AUTH_TOKEN globally.",
    );
  }
  return {
    client: new VobizClient({ apiUrl, authId, authToken, fromNumber: fromNumber || "" }),
    fromNumber: fromNumber || "",
    authId,
    authToken,
  };
}

/**
 * Resolve only the caller-ID number for a tenant. Returns the tenant's assigned
 * number first, then the global VOBIZ_FROM_NUMBER, then null.
 */
export async function resolveOutboundNumber(
  dbRef: any,
  tenantId: string,
): Promise<string | null> {
  const [numberRow] = await dbRef
    .select()
    .from(schema.phoneNumbers)
    .where(
      and(
        eq(schema.phoneNumbers.tenantId, tenantId),
        eq(schema.phoneNumbers.status, ALLOWED_NUMBER_STATUS),
      ),
    )
    .limit(1);

  if (numberRow?.numberE164) return numberRow.numberE164;
  return serverConfig.vobiz.fromNumber || null;
}

/**
 * Given an arbitrary tenantId-scoped resolver, produce the full caller-ID
 * context (number + optional tenant client). If the tenant has no stored
 * credentials, returns env-based VobizClient so number resolution can happen,
 * or null when nothing is configured.
 */
export async function resolveTenantCallerId(
  dbRef: any,
  tenantId: string,
): Promise<TenantCallerId | null> {
  try {
    const cfg = await getTenantVobizConfig(dbRef, tenantId);
    return {
      fromNumber: cfg.fromNumber,
      client: cfg.client,
      authId: cfg.authId,
      authToken: cfg.authToken,
    };
  } catch {
    return null;
  }
}

async function loadTenantVobiz(
  dbRef: any,
  tenantId: string,
): Promise<TenantVobizConfig | null> {
  const [cred] = await dbRef
    .select()
    .from(schema.integrationCredentials)
    .where(
      and(
        eq(schema.integrationCredentials.tenantId, tenantId),
        eq(schema.integrationCredentials.integration, "vobiz"),
      ),
    )
    .limit(1);

  if (!cred?.credentialsEncrypted) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cred.credentialsEncrypted) as Record<string, unknown>;
  } catch {
    return null;
  }

  const authId = typeof parsed.authId === "string" ? parsed.authId : "";
  const authToken = typeof parsed.authToken === "string" ? parsed.authToken : "";
  if (!authId || !authToken) return null;

  const [numberRow] = await dbRef
    .select()
    .from(schema.phoneNumbers)
    .where(
      and(
        eq(schema.phoneNumbers.tenantId, tenantId),
        eq(schema.phoneNumbers.status, ALLOWED_NUMBER_STATUS),
      ),
    )
    .limit(1);

  let fromNumber = numberRow?.numberE164 || "";
  if (!fromNumber) {
    const res = await resolveOutboundNumber(dbRef, tenantId);
    fromNumber = res ?? "";
  }

  const client = new VobizClient({
    apiUrl: serverConfig.vobiz.apiUrl,
    authId,
    authToken,
    fromNumber,
  });

  return { client, fromNumber, authId, authToken };
}