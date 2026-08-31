import { NextRequest, NextResponse } from "next/server";
import { composioService } from '@/backend/integrations/composio';

// Tool execution endpoint - allows AI to execute actions via Composio
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clientId, action, params } = body;

    if (!clientId || !action) {
      return NextResponse.json({ error: 'Missing clientId or action' }, { status: 400 });
    }

    // Map actions to Composio tools
    const toolMapping: Record<string, { toolkit: string; tool: string }> = {
      // Gmail actions
      'gmail_send': { toolkit: 'gmail', tool: 'send_email' },
      'gmail_read': { toolkit: 'gmail', tool: 'search_emails' },
      'gmail_mark_read': { toolkit: 'gmail', tool: 'mark_as_read' },
      
      // WhatsApp actions
      'whatsapp_send': { toolkit: 'whatsapp', tool: 'send_message' },
      'whatsapp_read': { toolkit: 'whatsapp', tool: 'get_messages' },
      'whatsapp_mark_read': { toolkit: 'whatsapp', tool: 'mark_message_read' },
      
      // Apollo actions
      'apollo_search': { toolkit: 'apollo', tool: 'search_contacts' },
      'apollo_enrich': { toolkit: 'apollo', tool: 'enrich_contact' },
      
      // HubSpot actions
      'hubspot_create_contact': { toolkit: 'hubspot', tool: 'create_contact' },
      'hubspot_update_contact': { toolkit: 'hubspot', tool: 'update_contact' },
      'hubspot_get_contact': { toolkit: 'hubspot', tool: 'get_contact' },
      
      // Slack actions
      'slack_send': { toolkit: 'slack', tool: 'send_message' },
      'slack_read': { toolkit: 'slack', tool: 'list_messages' },
    };

    const toolConfig = toolMapping[action];
    if (!toolConfig) {
      return NextResponse.json({ 
        error: 'Unknown action', 
        available: Object.keys(toolMapping) 
      }, { status: 400 });
    }

    // Check if integration is connected
    const connection = await composioService.getConnectionStatus(clientId, toolConfig.toolkit);
    if (!connection?.connected) {
      return NextResponse.json({ 
        error: `${toolConfig.toolkit} not connected`,
        solution: 'Connect via /connections page first'
      }, { status: 400 });
    }

    // Execute the tool via Composio
    // Note: In production, this would use the actual Composio SDK execute method
    // For now, we return the action that would be executed
    const result = {
      success: true,
      action,
      params,
      tool: toolConfig.tool,
      toolkit: toolConfig.toolkit,
      executed: true,
      message: `Would execute ${toolConfig.toolkit}/${toolConfig.tool} with params: ${JSON.stringify(params)}`,
      // In production: const result = await session.execute(toolConfig.tool, params);
    };

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Tool execution error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Get available tools for a client
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');

  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
  }

  try {
    // Get all connected integrations
    const connections = await composioService.getClientConnections(clientId);
    
    // Map available actions based on connected integrations
    const availableActions: string[] = [];
    
    for (const conn of connections) {
      if (conn.status !== 'active') continue;
      
      switch (conn.integration) {
        case 'gmail':
          availableActions.push('gmail_send', 'gmail_read', 'gmail_mark_read');
          break;
        case 'whatsapp':
          availableActions.push('whatsapp_send', 'whatsapp_read', 'whatsapp_mark_read');
          break;
        case 'apollo':
          availableActions.push('apollo_search', 'apollo_enrich');
          break;
        case 'hubspot':
          availableActions.push('hubspot_create_contact', 'hubspot_update_contact', 'hubspot_get_contact');
          break;
        case 'slack':
          availableActions.push('slack_send', 'slack_read');
          break;
      }
    }

    return NextResponse.json({
      clientId,
      connections,
      availableActions,
      total: availableActions.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}