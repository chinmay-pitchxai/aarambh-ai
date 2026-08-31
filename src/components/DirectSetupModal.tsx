"use client";

import { useState } from "react";

interface DirectSetupModalProps {
  integration: string;
  integrationName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const FIELDS: Record<string, { key: string; label: string; placeholder: string; type?: string }[]> = {
  whatsapp: [
    { key: "phoneNumberId", label: "Phone Number ID", placeholder: "e.g. 1234567890" },
    { key: "accessToken", label: "Access Token", placeholder: "WhatsApp Business API token", type: "password" },
    { key: "businessAccountId", label: "Business Account ID (optional)", placeholder: "WABA ID" },
  ],
  gmail: [
    { key: "clientId", label: "Client ID", placeholder: "Google OAuth Client ID" },
    { key: "clientSecret", label: "Client Secret", placeholder: "Google OAuth Client Secret", type: "password" },
    { key: "refreshToken", label: "Refresh Token (optional)", placeholder: "If you have one", type: "password" },
  ],
  slack: [
    { key: "botToken", label: "Bot Token", placeholder: "xoxb-...", type: "password" },
    { key: "webhookUrl", label: "Webhook URL (optional)", placeholder: "https://hooks.slack.com/..." },
  ],
  hubspot: [
    { key: "apiKey", label: "API Key", placeholder: "HubSpot API key", type: "password" },
  ],
  notion: [
    { key: "apiKey", label: "Integration Token", placeholder: "secret_..." , type: "password" },
  ],
  maps: [
    { key: "apiKey", label: "API Key", placeholder: "Google Maps API key", type: "password" },
  ],
};

const DESCRIPTIONS: Record<string, string> = {
  whatsapp: "Connect your WhatsApp Business API directly. You'll need a Meta Business account and an approved WhatsApp Business API provider.",
  gmail: "Connect Gmail via OAuth2. Create a project in Google Cloud Console, enable Gmail API, and create OAuth2 credentials.",
  slack: "Connect Slack for notifications. Create a Slack app and install it to your workspace.",
  hubspot: "Connect HubSpot CRM. Get your API key from HubSpot Settings → Integrations → API Key.",
  notion: "Connect Notion for logging. Create an integration at notion.so/my-integrations.",
  maps: "Connect Google Maps for lead enrichment. Enable Maps API in Google Cloud Console.",
};

export default function DirectSetupModal({ integration, integrationName, onClose, onSuccess }: DirectSetupModalProps) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [accountEmail, setAccountEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const fields = FIELDS[integration] || [];
  const description = DESCRIPTIONS[integration] || "";

  async function handleSubmit() {
    setLoading(true);
    setError(null);

    // Filter out empty optional fields
    const filled = Object.fromEntries(
      Object.entries(credentials).filter(([, v]) => v.trim() !== "")
    );

    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integration,
          clientId: "demo",
          credentials: filled,
          accountEmail: accountEmail || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to connect");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", borderRadius: 20,
          border: "1px solid var(--border)",
          width: "100%", maxWidth: 480,
          boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--text)" }}>Direct Setup — {integrationName}</h3>
            <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "4px 0 0" }}>Enter your API credentials</p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8,
              width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "var(--text-dim)", fontSize: 16,
            }}
          >×</button>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px" }}>
          {/* Description */}
          {description && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6, marginBottom: 16, padding: "10px 14px", background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)" }}>
              {description}
            </div>
          )}

          {success ? (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--green)" }}>Connected successfully!</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Account email (optional) */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
                  Account Label (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. john@company.com"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 13,
                    background: "var(--surface-2)", border: "1px solid var(--border)",
                    color: "var(--text)", outline: "none",
                  }}
                />
              </div>

              {/* Dynamic fields */}
              {fields.map((field) => (
                <div key={field.key}>
                  <label style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
                    {field.label}
                  </label>
                  <input
                    type={field.type || "text"}
                    placeholder={field.placeholder}
                    value={credentials[field.key] || ""}
                    onChange={(e) => setCredentials({ ...credentials, [field.key]: e.target.value })}
                    style={{
                      width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 13,
                      background: "var(--surface-2)", border: "1px solid var(--border)",
                      color: "var(--text)", outline: "none",
                    }}
                  />
                </div>
              ))}

              {error && (
                <div style={{ fontSize: 12, color: "var(--terracotta)", background: "var(--terracotta-soft)", padding: "8px 12px", borderRadius: 8 }}>
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={onClose}
              style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-dim)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)",
                opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? "Connecting..." : "Connect"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
