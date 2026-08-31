import { NextRequest, NextResponse } from "next/server";
import { composioService } from '@/backend/integrations/composio';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const integration = searchParams.get('integration');
  const clientId = searchParams.get('clientId');

  if (!action) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  // integration and clientId only required for some actions
  if (action !== 'integrations' && (!integration || !clientId)) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'connect': {
        const baseUrl = req.nextUrl.origin;
        const callbackUrl = `${baseUrl}/api/composio/callback?clientId=${encodeURIComponent(clientId)}&integration=${encodeURIComponent(integration)}`;

        const result = await composioService.initiateConnection(clientId, integration, callbackUrl);

        if (result.needsConfig) {
          return NextResponse.json({
            success: false,
            needsConfig: true,
            error: result.error,
          });
        }

        if (result.alreadyConnected) {
          return NextResponse.json({
            success: true,
            alreadyConnected: true,
          });
        }

        if (result.redirectUrl) {
          return NextResponse.json({
            success: true,
            needsAuth: true,
            authUrl: result.redirectUrl,
            connectedAccountId: result.connectedAccountId,
          });
        }

        return NextResponse.json({
          success: false,
          error: result.error || 'Failed to create connection link',
        });
      }

      case 'status': {
        const connection = await composioService.getConnectionStatus(clientId, integration);
        return NextResponse.json({
          connected: connection?.connected ?? false,
          status: connection?.status,
          accountEmail: connection?.accountEmail,
          composioAccountId: connection?.composioAccountId,
          lastSyncedAt: connection?.lastSyncedAt,
        });
      }

      case 'integrations': {
        const integrations = await composioService.getAvailableIntegrations();
        return NextResponse.json({ integrations });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('Composio API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, integration, clientId } = body;

    if (!action || !integration || !clientId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    if (action === 'disconnect') {
      const result = await composioService.disconnectIntegration(clientId, integration);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    console.error('Composio POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
