"use client";

import { useEffect, useState, useCallback } from "react";

interface Integration {
  id: string;
  name: string;
  desc: string;
  icon: string;
  category: string;
  color: string;
}

const INTEGRATIONS: Integration[] = [
  { id: "gmail", name: "Gmail", desc: "Email outreach + calendar access", icon: "✉", category: "Email", color: "#C17C60" },
  { id: "whatsapp", name: "WhatsApp", desc: "Send messages and nurture leads", icon: "◈", category: "Messaging", color: "#7A9A7E" },
  { id: "googlemeet", name: "Google Meet", desc: "Create and manage video meetings", icon: "◉", category: "Meetings", color: "#8A9A8B" },
  { id: "zoom", name: "Zoom", desc: "Schedule and host video calls", icon: "◎", category: "Meetings", color: "#4A8BC2" },
  { id: "microsoft_teams", name: "Microsoft Teams", desc: "Chat, meet, and collaborate", icon: "◻", category: "Meetings", color: "#6264A7" },
  { id: "slack", name: "Slack", desc: "Get alerts for bookings & failures", icon: "⬢", category: "Ops", color: "#B0A9A0" },
  { id: "hubspot", name: "HubSpot", desc: "Sync contacts & deals to CRM", icon: "⬡", category: "CRM", color: "#C9A86A" },
  { id: "salesforce", name: "Salesforce", desc: "Enterprise CRM sync", icon: "◆", category: "CRM", color: "#4A8BC2" },
];

const CLIENT_ID = "demo";

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Record<string, { connected: boolean; status?: string; accountEmail?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchAllStatuses = useCallback(async () => {
    try {
      const results: Record<string, { connected: boolean; status?: string; accountEmail?: string }> = {};
      for (const app of INTEGRATIONS) {
        try {
          const res = await fetch(`/api/composio?action=status&integration=${app.id}&clientId=${CLIENT_ID}`);
          if (res.ok) {
            const data = await res.json();
            results[app.id] = { connected: data.connected, status: data.status, accountEmail: data.accountEmail };
          } else {
            results[app.id] = { connected: false };
          }
        } catch {
          results[app.id] = { connected: false };
        }
      }
      setConnections(results);
    } catch {
      setError("Failed to load connection statuses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const errParam = params.get("error");

    if (connected) {
      setSuccess(`${connected} connected successfully!`);
      window.history.replaceState({}, "", "/connections");
      fetchAllStatuses();
    }
    if (errParam) {
      setError(`Connection failed: ${decodeURIComponent(errParam)}`);
      window.history.replaceState({}, "", "/connections");
    }
    fetchAllStatuses();
  }, [fetchAllStatuses]);

  async function handleConnect(integration: string) {
    setConnecting(integration);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/composio?action=connect&integration=${integration}&clientId=${CLIENT_ID}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to initiate connection");
        return;
      }
      if (data.alreadyConnected) {
        setSuccess(`${integration} is already connected`);
        setConnections(prev => ({ ...prev, [integration]: { connected: true, status: "active" } }));
        return;
      }
      if (data.needsAuth && data.authUrl) {
        window.location.href = data.authUrl;
        return;
      }
      setSuccess(`${integration} connected`);
      setConnections(prev => ({ ...prev, [integration]: { connected: true, status: "active" } }));
    } catch {
      setError("Network error — please try again");
    } finally {
      setConnecting(null);
    }
  }

  async function handleDisconnect(integration: string) {
    setConnecting(integration);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/composio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect", integration, clientId: CLIENT_ID }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`${integration} disconnected`);
        setConnections(prev => ({ ...prev, [integration]: { connected: false } }));
      } else {
        setError(data.error || "Failed to disconnect");
      }
    } catch {
      setError("Network error");
    } finally {
      setConnecting(null);
    }
  }

  const categories = ["All", ...Array.from(new Set(INTEGRATIONS.map((i) => i.category)))];
  const filtered = INTEGRATIONS.filter((i) => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.desc.toLowerCase().includes(search.toLowerCase());
    const matchCat = filter === "All" || i.category === filter;
    return matchSearch && matchCat;
  });

  const connectedCount = Object.values(connections).filter((c) => c.connected).length;

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: "0.02em", margin: 0 }}>Connections</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 6, letterSpacing: "0.02em" }}>
          Connect your tools — one click via Composio
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
            padding: "10px 14px", color: "var(--text)", fontSize: 14, width: 240, outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              style={{
                padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500, letterSpacing: "0.04em",
                cursor: "pointer", border: `1px solid ${filter === cat ? "var(--accent)" : "var(--border)"}`,
                background: filter === cat ? "var(--accent)" : "var(--surface)", color: filter === cat ? "#fff" : "var(--text-dim)",
              }}
            >
              {cat}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-light)", letterSpacing: "0.04em" }}>
          {connectedCount} / {INTEGRATIONS.length} connected
        </span>
      </div>

      {error && (
        <div onClick={() => setError(null)} style={{
          background: "rgba(193,124,96,0.1)", border: "1px solid rgba(193,124,96,0.3)", borderRadius: 10,
          padding: 12, marginBottom: 16, color: "var(--terracotta)", fontSize: 13, cursor: "pointer",
        }}>
          {error} <span style={{ marginLeft: 8, opacity: 0.6 }}>dismiss</span>
        </div>
      )}
      {success && (
        <div onClick={() => setSuccess(null)} style={{
          background: "rgba(122,154,126,0.1)", border: "1px solid rgba(122,154,126,0.3)", borderRadius: 10,
          padding: 12, marginBottom: 16, color: "var(--green)", fontSize: 13, cursor: "pointer",
        }}>
          {success} <span style={{ marginLeft: 8, opacity: 0.6 }}>dismiss</span>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-light)", letterSpacing: "0.06em", fontSize: 13, textTransform: "uppercase" }}>Loading —</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {filtered.map((app) => {
            const status = connections[app.id];
            const isConnected = status?.connected || false;

            return (
              <div key={app.id} className="glow-card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                    background: isConnected ? "var(--accent-soft)" : "var(--surface-2)",
                    border: `1px solid ${isConnected ? "var(--accent)" : "var(--border)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: app.color,
                  }}>
                    {app.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", letterSpacing: "0.02em" }}>{app.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{app.category}</div>
                  </div>
                  {isConnected && <span style={{ fontSize: 11, color: "var(--green)", background: "rgba(122,154,126,0.12)", padding: "4px 8px", borderRadius: 10, border: "1px solid rgba(122,154,126,0.2)" }}>●</span>}
                </div>

                <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{app.desc}</div>

                {isConnected && status?.accountEmail && (
                  <div style={{ fontSize: 11, color: "var(--text-light)" }}>{status.accountEmail}</div>
                )}

                <button
                  onClick={() => isConnected ? handleDisconnect(app.id) : handleConnect(app.id)}
                  disabled={connecting === app.id}
                  style={{
                    marginTop: "auto", width: "100%", padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500,
                    cursor: "pointer",
                    background: isConnected ? "var(--surface-2)" : "var(--accent)",
                    color: isConnected ? "var(--text-dim)" : "#fff",
                    border: `1px solid ${isConnected ? "var(--border)" : "var(--accent)"}`,
                    opacity: connecting === app.id ? 0.5 : 1,
                  }}
                >
                  {connecting === app.id ? "..." : isConnected ? "Disconnect" : "Connect"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {filtered.length === 0 && !loading && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-light)", fontSize: 13 }}>No integrations match</div>
      )}

      <div style={{
        marginTop: 32, padding: 20, background: "var(--warm)", borderRadius: 12, border: "1px solid var(--border)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Powered by Composio</div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>OAuth handled securely — no API keys stored locally</div>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.06em", textTransform: "uppercase", background: "var(--surface)", padding: "6px 12px", borderRadius: 20, border: "1px solid var(--border)" }}>One-click</span>
      </div>
    </div>
  );
}
