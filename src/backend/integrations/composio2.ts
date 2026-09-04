import { Composio } from '@composio/core';
import { db, schema } from '@/backend/db';
import { and, eq } from 'drizzle-orm';

interface ConnectionStatus {
  connected: boolean;
  status?: string;
  accountEmail?: string;
  composioAccountId?: string;
  lastSyncedAt?: Date;
}

const AUTH_CONFIG_MAP2: Record<string, string> = {};

const SLUG_MAP: Record<string, string> = {
  gmail: "gmail",
  whatsapp: "whatsapp",
  google_maps: "google_maps",
  google_calendar: "googlecalendar",
  googlemeet: "googlemeet",
  slack: "slack",
  hubspot: "hubspot",
  notion: "notion",
  vobiz: "vobiz",
  zoom: "zoom",
};

export const GOOGLE_CALENDAR_INTEGRATION_ID = "google_calendar";
export const GOOGLE_CALENDAR_TOOLKIT_SLUG = "GOOGLECALENDAR";

export interface CalendarConnectionState {
  authConfigExists: boolean;
  connected: boolean;
  status: string | null;
  accountEmail: string | null;
  connectedAccountId: string | null;
}

let authConfigMapLoaded = false;

export class Composio2Service {
  private composio: Composio | null = null;

  getClient(): Composio {
    if (!this.composio) {
      const apiKey = process.env.COMPOSIO2_API_KEY;
      if (!apiKey) {
        throw new Error('COMPOSIO2_API_KEY is not set');
      }
      this.composio = new Composio({ apiKey });
    }
    return this.composio;
  }

  async loadAuthConfigs(): Promise<void> {
    if (authConfigMapLoaded) return;
    try {
      const client = this.getClient();
      const result = await client.getClient().authConfigs.list({});
      for (const config of result.items || []) {
        const slug = config.toolkit?.slug;
        if (slug) {
          const slugLower = slug.toLowerCase();
          const integrationId =
            Object.entries(SLUG_MAP).find(([, s]) => s.toLowerCase() === slugLower)?.[0] ??
            (slugLower === GOOGLE_CALENDAR_TOOLKIT_SLUG.toLowerCase()
              ? GOOGLE_CALENDAR_INTEGRATION_ID
              : undefined);
          if (integrationId && !AUTH_CONFIG_MAP2[integrationId]) {
            AUTH_CONFIG_MAP2[integrationId] = config.id;
          }
          if (!AUTH_CONFIG_MAP2[slug]) {
            AUTH_CONFIG_MAP2[slug] = config.id;
          }
        }
      }
      authConfigMapLoaded = true;
    } catch (error) {
      console.error('Failed to load auth configs:', error);
    }
  }

  getAuthConfigId(integration: string): string | null {
    return AUTH_CONFIG_MAP2[integration] || null;
  }

  async getConnectionStatus(clientId: string, integration: string): Promise<ConnectionStatus | null> {
    const [connection] = await db
      .select()
      .from(schema.oauthConnections)
      .where(
        and(
          eq(schema.oauthConnections.clientId, clientId),
          eq(schema.oauthConnections.integration, integration)
        )
      );

    if (!connection) return null;
    return {
      connected: connection.status === 'active',
      status: connection.status || undefined,
      accountEmail: connection.accountEmail || undefined,
      composioAccountId: connection.composioConnectionId || undefined,
      lastSyncedAt: connection.lastSyncedAt || undefined,
    };
  }

  async initiateConnection(
    clientId: string,
    integration: string,
    callbackUrl: string
  ): Promise<{
    success: boolean;
    redirectUrl?: string;
    connectedAccountId?: string;
    alreadyConnected?: boolean;
    error?: string;
    needsConfig?: boolean;
  }> {
    try {
      const existing = await this.getConnectionStatus(clientId, integration);
      if (existing?.connected) {
        return { success: true, alreadyConnected: true };
      }

      await this.loadAuthConfigs();

      const authConfigId = AUTH_CONFIG_MAP2[integration];
      if (!authConfigId) {
        return {
          success: false,
          needsConfig: true,
          error: `No auth config found for "${integration}". Create one in the Composio dashboard first.`
        };
      }

      const client = this.getClient();
      const composioClient = client.getClient();

      const linkResult = await composioClient.link.create({
        user_id: clientId,
        auth_config_id: authConfigId,
        callback_url: callbackUrl,
      });

      return {
        success: true,
        redirectUrl: (linkResult as any).redirectUrl || (linkResult as any).redirect_url || (linkResult as any).redirect_url,
        connectedAccountId: (linkResult as any).connectedAccountId || (linkResult as any).connected_account_id,
      };
    } catch (error: any) {
      console.error('Connection initiation error:', error);
      return { success: false, error: error.message || 'Failed to initiate connection' };
    }
  }

  async handleCallback(params: {
    clientId: string;
    integration: string;
    connectedAccountId: string;
    status?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const { clientId, integration, connectedAccountId, status } = params;

      let accountEmail: string | undefined;
      try {
        const client = this.getClient();
        const composioClient = client.getClient();
        const account = await composioClient.connectedAccounts.retrieve(connectedAccountId);
        accountEmail = (account as any).email || (account as any).userEmail || undefined;
      } catch {
        // Non-fatal: we'll just use a placeholder
      }

      await db
        .insert(schema.oauthConnections)
        .values({
          clientId,
          integration,
          composioConnectionId: connectedAccountId,
          accountEmail: accountEmail || `connected@${integration}.com`,
          status: status === 'error' ? 'error' : 'active',
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.oauthConnections.clientId, schema.oauthConnections.integration],
          set: {
            composioConnectionId: connectedAccountId,
            accountEmail: accountEmail || `connected@${integration}.com`,
            status: status === 'error' ? 'error' : 'active',
            lastSyncedAt: new Date(),
          },
        });

      return { success: true };
    } catch (error: any) {
      console.error('Callback handling error:', error);
      return { success: false, error: error.message };
    }
  }

  async disconnectIntegration(
    clientId: string,
    integration: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const connection = await this.getConnectionStatus(clientId, integration);
      if (!connection?.connected) {
        return { success: true };
      }

      if (connection.composioAccountId) {
        try {
          const client = this.getClient();
          const composioClient = client.getClient();
          await composioClient.connectedAccounts.delete(connection.composioAccountId, {
            revoke_on_delete: true,
          });
        } catch (err: any) {
          console.warn('Failed to delete from Composio (non-fatal):', err.message);
        }
      }

      await db
        .delete(schema.oauthConnections)
        .where(
          and(
            eq(schema.oauthConnections.clientId, clientId),
            eq(schema.oauthConnections.integration, integration)
          )
        );

      return { success: true };
    } catch (error: any) {
      console.error('Disconnect error:', error);
      return { success: false, error: error.message };
    }
  }

  async getClientConnections(clientId: string): Promise<Array<{
    integration: string;
    status: string;
    accountEmail?: string;
    composioAccountId?: string;
  }>> {
    const connections = await db
      .select({
        integration: schema.oauthConnections.integration,
        status: schema.oauthConnections.status,
        accountEmail: schema.oauthConnections.accountEmail,
        composioConnectionId: schema.oauthConnections.composioConnectionId,
      })
      .from(schema.oauthConnections)
      .where(eq(schema.oauthConnections.clientId, clientId));

    return connections.map(c => ({
      integration: c.integration,
      status: c.status || '',
      accountEmail: c.accountEmail || undefined,
      composioAccountId: c.composioConnectionId || undefined,
    }));
  }

  async ensureCalendarAuthConfig(): Promise<{
    created: boolean;
    authConfigId: string | null;
    toolkitSlugUsed?: string;
    error?: string;
  }> {
    await this.loadAuthConfigs();
    const existing = AUTH_CONFIG_MAP2[GOOGLE_CALENDAR_INTEGRATION_ID];
    if (existing) {
      return { created: false, authConfigId: existing };
    }

    const client = this.getClient();

    let toolkitSlugUsed = GOOGLE_CALENDAR_TOOLKIT_SLUG;
    try {
      await client.toolkits.get(GOOGLE_CALENDAR_TOOLKIT_SLUG);
    } catch {
      toolkitSlugUsed = GOOGLE_CALENDAR_TOOLKIT_SLUG.toLowerCase();
    }

    const createWith = async (toolkitSlug: string) => {
      const created = await client.authConfigs.create(toolkitSlug, {
        type: "use_composio_managed_auth",
      });
      AUTH_CONFIG_MAP2[GOOGLE_CALENDAR_INTEGRATION_ID] = created.id;
      AUTH_CONFIG_MAP2[toolkitSlug] = created.id;
      return created.id;
    };

    try {
      const authConfigId = await createWith(toolkitSlugUsed);
      return { created: true, authConfigId, toolkitSlugUsed };
    } catch (err: unknown) {
      const fallback =
        toolkitSlugUsed === GOOGLE_CALENDAR_TOOLKIT_SLUG
          ? GOOGLE_CALENDAR_TOOLKIT_SLUG.toLowerCase()
          : GOOGLE_CALENDAR_TOOLKIT_SLUG;
      try {
        const authConfigId = await createWith(fallback);
        return { created: true, authConfigId, toolkitSlugUsed: fallback };
      } catch (fallbackErr: unknown) {
        const message =
          fallbackErr instanceof Error
            ? fallbackErr.message
            : err instanceof Error
              ? err.message
              : "Failed to create Google Calendar auth config";
        return { created: false, authConfigId: null, toolkitSlugUsed, error: message };
      }
    }
  }

  async refreshConnectedAccount(
    accountId: string
  ): Promise<{ success: boolean; status?: string; error?: string }> {
    try {
      const client = this.getClient();
      const refreshed = await client.connectedAccounts.refresh(accountId);
      const status =
        refreshed && typeof refreshed === "object" && "status" in refreshed
          ? String((refreshed as { status: unknown }).status)
          : undefined;
      return { success: true, status };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to refresh connected account",
      };
    }
  }

  async getCalendarConnectionState(tenantId: string): Promise<CalendarConnectionState> {
    await this.loadAuthConfigs();
    const authConfigExists = Boolean(AUTH_CONFIG_MAP2[GOOGLE_CALENDAR_INTEGRATION_ID]);

    const [connection] = await db
      .select()
      .from(schema.oauthConnections)
      .where(
        and(
          eq(schema.oauthConnections.clientId, tenantId),
          eq(schema.oauthConnections.integration, GOOGLE_CALENDAR_INTEGRATION_ID)
        )
      );

    if (!connection) {
      return {
        authConfigExists,
        connected: false,
        status: null,
        accountEmail: null,
        connectedAccountId: null,
      };
    }

    const status = connection.status ?? null;
    return {
      authConfigExists,
      connected: status === "active" && Boolean(connection.composioConnectionId),
      status,
      accountEmail: connection.accountEmail ?? null,
      connectedAccountId: connection.composioConnectionId ?? null,
    };
  }

  async getAvailableIntegrations(): Promise<Array<{
    slug: string;
    authConfigId: string;
    name: string;
  }>> {
    await this.loadAuthConfigs();
    return Object.entries(AUTH_CONFIG_MAP2).map(([slug, id]) => ({
      slug,
      authConfigId: id,
      name: slug,
    }));
  }

  /**
   * Resolve the Composio connected account for a tenant + integration.
   * Prefers the cached oauthConnections row; if missing or not active, falls
   * back to discovering the tenant's accounts directly from Composio2
   * (matched by `user_id`), then caches the match in oauthConnections so the
   * automation keeps working without a fresh connect flow.
   */
  async resolveConnectedAccount(
    tenantId: string,
    integration: string,
  ): Promise<string | null> {
    const [existing] = await db
      .select()
      .from(schema.oauthConnections)
      .where(
        and(
          eq(schema.oauthConnections.clientId, tenantId),
          eq(schema.oauthConnections.integration, integration),
        )
      );

    if (existing?.status === "active" && existing.composioConnectionId) {
      return existing.composioConnectionId;
    }

    try {
      const client = this.getClient();
      const composioClient = client.getClient();
      const result = await composioClient.connectedAccounts.list({
        user_ids: [tenantId],
        statuses: ["ACTIVE"],
        account_type: "ALL",
      });

      const items = (result as any)?.items ?? (result as any)?.connectedAccounts ?? [];
      if (!Array.isArray(items) || items.length === 0) return null;

      const configId = AUTH_CONFIG_MAP2[integration] ?? AUTH_CONFIG_MAP2[SLUG_MAP[integration]] ?? null;

      const account = items.find((acc: Record<string, unknown>) => {
        if (configId) {
          const accConfig = String(acc["authConfigId"] ?? acc["auth_config_id"] ?? "");
          if (accConfig === configId) return true;
        }
        const app = String(acc["client_unique_id"] ?? acc["app"] ?? "");
        const toolkit = String(acc["toolkit"] ?? "");
        return (
          app.toLowerCase() === integration.toLowerCase() ||
          toolkit.toLowerCase() === integration.toLowerCase() ||
          toolkit.toLowerCase() === (SLUG_MAP[integration] ?? "").toLowerCase()
        );
      });

      const accountId = account ? String(account["id"] ?? "") : "";
      if (!accountId) return null;

      const email =
        typeof account["email"] === "string"
          ? account["email"]
          : (account as Record<string, unknown>)["userEmail"] as string | undefined;

      await db
        .insert(schema.oauthConnections)
        .values({
          clientId: tenantId,
          integration,
          composioConnectionId: accountId,
          accountEmail: email || `connected@${integration}.com`,
          status: "active",
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.oauthConnections.clientId, schema.oauthConnections.integration],
          set: {
            composioConnectionId: accountId,
            accountEmail: email || `connected@${integration}.com`,
            status: "active",
            lastSyncedAt: new Date(),
          },
        });

      return accountId;
    } catch (error) {
      console.error(`[composio2] resolveConnectedAccount failed for ${integration}`, error);
      return null;
    }
  }
}

export const composio2Service = new Composio2Service();