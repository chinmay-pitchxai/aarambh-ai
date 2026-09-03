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

// Maps our integration IDs to Composio auth config IDs
const AUTH_CONFIG_MAP: Record<string, string> = {};

// Maps our integration IDs to Composio toolkit slugs
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
};

// Canonical Composio toolkit slug for Google Calendar (per
// https://docs.composio.dev/toolkits/googlecalendar). The toolkit API accepts
// both casings, but the canonical/docs form — also used as the prefix of every
// Google Calendar tool slug (e.g. GOOGLECALENDAR_CREATE_EVENT) — is uppercase.
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

export class ComposioService {
  private composio: Composio | null = null;

  getClient(): Composio {
    if (!this.composio) {
      const apiKey = process.env.COMPOSIO_API_KEY;
      if (!apiKey) {
        throw new Error('COMPOSIO_API_KEY is not set');
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
          // Map the slug to our integration ID and store the auth config ID.
          // Match case-insensitively: Composio reports the Google Calendar
          // toolkit slug in its canonical uppercase form ("GOOGLECALENDAR")
          // while SLUG_MAP stores it lowercase ("googlecalendar").
          const slugLower = slug.toLowerCase();
          const integrationId =
            Object.entries(SLUG_MAP).find(([, s]) => s.toLowerCase() === slugLower)?.[0] ??
            (slugLower === GOOGLE_CALENDAR_TOOLKIT_SLUG.toLowerCase()
              ? GOOGLE_CALENDAR_INTEGRATION_ID
              : undefined);
          if (integrationId && !AUTH_CONFIG_MAP[integrationId]) {
            AUTH_CONFIG_MAP[integrationId] = config.id;
          }
          // Also store by slug directly
          if (!AUTH_CONFIG_MAP[slug]) {
            AUTH_CONFIG_MAP[slug] = config.id;
          }
        }
      }
      authConfigMapLoaded = true;
    } catch (error) {
      console.error('Failed to load auth configs:', error);
    }
  }

  getAuthConfigId(integration: string): string | null {
    return AUTH_CONFIG_MAP[integration] || null;
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
      // Check if already connected
      const existing = await this.getConnectionStatus(clientId, integration);
      if (existing?.connected) {
        return { success: true, alreadyConnected: true };
      }

      // Load auth configs if not loaded
      await this.loadAuthConfigs();

      // Get the auth config for this integration
      const authConfigId = AUTH_CONFIG_MAP[integration];
      if (!authConfigId) {
        return {
          success: false,
          needsConfig: true,
          error: `No auth config found for "${integration}". Create one in the Composio dashboard first.`
        };
      }

      // Create a link session via Composio SDK
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

      // Try to get account info from Composio
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
      // Get the connection to find the composio account ID
      const connection = await this.getConnectionStatus(clientId, integration);
      if (!connection?.connected) {
        return { success: true }; // Already disconnected
      }

      // Try to delete from Composio if we have the account ID
      if (connection.composioAccountId) {
        try {
          const client = this.getClient();
          const composioClient = client.getClient();
          await composioClient.connectedAccounts.delete(connection.composioAccountId, {
            revoke_on_delete: true,
          });
        } catch (err: any) {
          console.warn('Failed to delete from Composio (non-fatal):', err.message);
          // Continue with local deletion even if Composio API fails
        }
      }

      // Delete from our DB
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

  /**
   * Ensure a Composio auth config exists for the Google Calendar toolkit,
   * creating one with Composio Managed Auth when missing.
   *
   * Verified live (2026-09-03): `toolkits.get("GOOGLECALENDAR")` resolves,
   * so the uppercase canonical slug is tried first, with a lowercase
   * fallback. Returns whether a config was created and its id.
   */
   async ensureCalendarAuthConfig(): Promise<{
    created: boolean;
    authConfigId: string | null;
    toolkitSlugUsed?: string;
    error?: string;
  }> {
    await this.loadAuthConfigs();
    const existing = AUTH_CONFIG_MAP[GOOGLE_CALENDAR_INTEGRATION_ID];
    if (existing) {
      return { created: false, authConfigId: existing };
    }

    const client = this.getClient();

    // Read-only casing check: prefer the canonical uppercase slug when the
    // toolkit API recognises it.
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
      AUTH_CONFIG_MAP[GOOGLE_CALENDAR_INTEGRATION_ID] = created.id;
      AUTH_CONFIG_MAP[toolkitSlug] = created.id;
      return created.id;
    };

    try {
      const authConfigId = await createWith(toolkitSlugUsed);
      return { created: true, authConfigId, toolkitSlugUsed };
    } catch (err: unknown) {
      // Fall back to the alternate casing once before giving up.
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

  /**
   * Refresh a stale/expired connected account's credentials via
   * `connectedAccounts.refresh`. Returns success plus the account status when
   * available. Callers should force full re-auth when this fails.
   */
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

  /**
   * Calendar-focused connection state for a tenant: whether a Google Calendar
   * auth config exists in Composio plus the local oauthConnections row.
   */
   async getCalendarConnectionState(tenantId: string): Promise<CalendarConnectionState> {
    await this.loadAuthConfigs();
    const authConfigExists = Boolean(AUTH_CONFIG_MAP[GOOGLE_CALENDAR_INTEGRATION_ID]);

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
    return Object.entries(AUTH_CONFIG_MAP).map(([slug, id]) => ({
      slug,
      authConfigId: id,
      name: slug,
    }));
  }
}

export const composioService = new ComposioService();
