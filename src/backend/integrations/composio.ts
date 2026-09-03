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
  slack: "slack",
  hubspot: "hubspot",
  notion: "notion",
};

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
          // Map the slug to our integration ID and store the auth config ID
          const integrationId = Object.entries(SLUG_MAP).find(([, s]) => s === slug)?.[0];
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
