import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/backend/db";
import { eq, and } from "drizzle-orm";

// POST - Save direct credentials for an integration
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { integration, clientId, credentials, accountEmail } = body;

    if (!integration || !clientId || !credentials) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate credentials based on integration type
    const validation = validateCredentials(integration, credentials);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Upsert the connection with credentials
    await db
      .insert(schema.oauthConnections)
      .values({
        clientId,
        integration,
        credentials,
        accountEmail: accountEmail || `direct@${integration}.com`,
        status: "active",
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.oauthConnections.clientId, schema.oauthConnections.integration],
        set: {
          credentials,
          accountEmail: accountEmail || `direct@${integration}.com`,
          status: "active",
          lastSyncedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true, message: `${integration} connected successfully` });
  } catch (error: any) {
    console.error("Direct connect error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// GET - Get credentials for an integration (masked)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const integration = searchParams.get("integration");
  const clientId = searchParams.get("clientId");

  if (!integration || !clientId) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const [connection] = await db
    .select()
    .from(schema.oauthConnections)
    .where(
      and(
        eq(schema.oauthConnections.clientId, clientId),
        eq(schema.oauthConnections.integration, integration)
      )
    );

  if (!connection || !connection.credentials) {
    return NextResponse.json({ connected: false });
  }

  // Return masked credentials
  const creds = connection.credentials as Record<string, string>;
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(creds)) {
    if (typeof value === "string" && value.length > 8) {
      masked[key] = value.slice(0, 4) + "••••••••" + value.slice(-4);
    } else {
      masked[key] = "••••••••";
    }
  }

  return NextResponse.json({
    connected: true,
    status: connection.status,
    credentials: masked,
    accountEmail: connection.accountEmail,
  });
}

function validateCredentials(integration: string, credentials: Record<string, string>): { valid: boolean; error?: string } {
  switch (integration) {
    case "whatsapp":
      if (!credentials.phoneNumberId) return { valid: false, error: "Phone Number ID is required" };
      if (!credentials.accessToken) return { valid: false, error: "Access Token is required" };
      return { valid: true };
    case "gmail":
      if (!credentials.clientId) return { valid: false, error: "Client ID is required" };
      if (!credentials.clientSecret) return { valid: false, error: "Client Secret is required" };
      return { valid: true };
    case "slack":
      if (!credentials.botToken) return { valid: false, error: "Bot Token is required" };
      return { valid: true };
    case "hubspot":
      if (!credentials.apiKey) return { valid: false, error: "API Key is required" };
      return { valid: true };
    case "notion":
      if (!credentials.apiKey) return { valid: false, error: "API Key is required" };
      return { valid: true };
    case "maps":
      if (!credentials.apiKey) return { valid: false, error: "API Key is required" };
      return { valid: true };
    default:
      return { valid: false, error: "Unknown integration" };
  }
}

// DELETE - Remove a direct connection
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const integration = searchParams.get("integration");
  const clientId = searchParams.get("clientId");

  if (!integration || !clientId) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  try {
    await db
      .delete(schema.oauthConnections)
      .where(
        and(
          eq(schema.oauthConnections.clientId, clientId),
          eq(schema.oauthConnections.integration, integration)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
