"use client";

import { useEffect, useState, useCallback } from "react";

interface Integration {
  id: string;
  name: string;
  desc: string;
  icon: string;
  category: string;
  color: string;
  via?: string;
}

const INTEGRATIONS: Integration[] = [
  { id: "whatsapp", name: "WhatsApp Business", desc: "Send messages and nurture leads via WhatsApp", icon: "◈", category: "Messaging", color: "#7A9A7E", via: "Composio" },
  { id: "gmail", name: "Gmail", desc: "Email outreach and calendar access via Gmail", icon: "✉", category: "Email", color: "#C17C60", via: "Composio" },
  { id: "google_calendar", name: "Google Calendar", desc: "Schedule meetings and check availability", icon: "📅", category: "Meetings", color: "#4285F4", via: "Composio" },
  { id: "googlemeet", name: "Google Meet", desc: "Create and manage video meetings", icon: "◉", category: "Meetings", color: "#8A9A8B", via: "Composio" },
  { id: "google_maps", name: "Google Maps", desc: "Location data for lead research and targeting", icon: "📍", category: "Data", color: "#EA4335", via: "Composio" },
  { id: "slack", name: "Slack", desc: "Team notifications and collaboration", icon: "⚡", category: "Messaging", color: "#611f69", via: "Composio" },
  { id: "hubspot", name: "HubSpot", desc: "CRM sync for contacts and deals", icon: "⬡", category: "CRM", color: "#FF7A59", via: "Composio" },
  { id: "notion", name: "Notion", desc: "Team workspace and documentation", icon: "▤", category: "Productivity", color: "#2D2D2D", via: "Composio" },
  { id: "vobiz", name: "Vobiz", desc: "Phone calls and voice outreach", icon: "📞", category: "Phone", color: "#6B8E7B", via: "API" },
];

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Record<string, { connected: boolean; status?: string; accountEmail?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [postPayment, setPostPayment] = useState(false);
  const [tenantId, setTenantId] = useState<string>("demo");
  const [needsSetup, setNeedsSetup] = useState<Record<string, boolean>>({});
  const [vobizDetail, setVobizDetail] = useState<string | null>(null);
  const [showVobizModal, setShowVobizModal] = useState(false);
  const [vobizAuthId, setVobizAuthId] = useState("");
  const [vobizAuthToken, setVobizAuthToken] = useState("");
  const [vobizConnecting, setVobizConnecting] = useState(false);
  const [vobizNumbers, setVobizNumbers] = useState<Array<{ id: string; e164: string; status: string; voiceEnabled: boolean }>>([]);
  const [vobizSelectedNumber, setVobizSelectedNumber] = useState<string | null>(null);
  const [vobizStep, setVobizStep] = useState<"credentials" | "numbers">("credentials");

  const fetchAllStatuses = useCallback(async (tid: string) => {
    try {
      const results: Record<string, { connected: boolean; status?: string; accountEmail?: string }> = {};
      for (const app of INTEGRATIONS) {
        if (app.id === "vobiz") {
          // Vobiz is a direct API integration — status comes from its own probe.
          try {
            const res = await fetch("/api/v1/integrations/vobiz/status", { credentials: "include" });
            if (res.ok) {
              const data = await res.json();
              results[app.id] = {
                connected: data.connected === true,
                status: data.connected ? "active" : data.error || "not configured",
              };
            } else {
              results[app.id] = { connected: false };
            }
          } catch {
            results[app.id] = { connected: false };
          }
          continue;
        }
        try {
          const res = await fetch(`/api/composio?action=status&integration=${app.id}&clientId=${encodeURIComponent(tid)}`);
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
    const activated = params.get("activated");

    if (activated === "true") {
      setPostPayment(true);
      setSuccess("Subscription activated! Connect your accounts to start automating.");
      window.history.replaceState({}, "", "/connections");
    }
    if (connected) {
      setSuccess(`${connected} connected successfully!`);
      window.history.replaceState({}, "", "/connections");
    }
    if (errParam) {
      setError(`Connection failed: ${decodeURIComponent(errParam)}`);
      window.history.replaceState({}, "", "/connections");
    }

    // Resolve the real tenant (org) for Composio lookups — never hardcode "demo".
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const tid = data?.org?.id || "demo";
        setTenantId(tid);
        fetchAllStatuses(tid);
        if (connected) fetchAllStatuses(tid);
      })
      .catch(() => fetchAllStatuses("demo"));
  }, [fetchAllStatuses]);

  async function handleVobizCheck() {
    setConnecting("vobiz");
    setError(null);
    setSuccess(null);
    setVobizDetail(null);
    try {
      const res = await fetch("/api/v1/integrations/vobiz/status", { credentials: "include" });
      const data = await res.json();
      if (data.connected) {
        const bits = [
          `API reachable (${data.latencyMs ?? "?"}ms)`,
          data.balance ? `balance ${data.balance.balance} ${data.balance.currency}` : null,
          data.hasProvisionedNumber ? "number provisioned" : "no number provisioned yet",
        ].filter(Boolean);
        setVobizDetail(bits.join(" · "));
        setSuccess("Vobiz is connected and authenticated.");
        setConnections((prev) => ({ ...prev, vobiz: { connected: true, status: "active" } }));
      } else {
        setVobizDetail(data.error || "Not configured");
        setError(data.setup || data.error || "Vobiz is not connected");
        setConnections((prev) => ({ ...prev, vobiz: { connected: false, status: data.error } }));
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setConnecting(null);
    }
  }

  function openVobizModal() {
    setVobizAuthId("");
    setVobizAuthToken("");
    setVobizNumbers([]);
    setVobizSelectedNumber(null);
    setVobizStep("credentials");
    setShowVobizModal(true);
    setError(null);
    setSuccess(null);
  }

  async function handleVobizConnect() {
    if (!vobizAuthId.trim() || !vobizAuthToken.trim()) {
      setError("Please enter both Auth ID and Auth Token");
      return;
    }
    setVobizConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/integrations/vobiz/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ authId: vobizAuthId.trim(), authToken: vobizAuthToken.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Connection failed");
        return;
      }
      setSuccess("Credentials verified! Fetching numbers…");
      const numRes = await fetch("/api/v1/integrations/vobiz/numbers", { credentials: "include" });
      const numData = await numRes.json();
      if (!numRes.ok) {
        setError(numData.error || "Failed to fetch numbers");
        return;
      }
      if (numData.numbers.length === 0) {
        setSuccess("Connected! No numbers found on this account. Purchase a number from Vobiz to start calling.");
        setConnections((prev) => ({ ...prev, vobiz: { connected: true, status: "active" } }));
        setVobizDetail(data.balance ? `balance ${data.balance.amount} ${data.balance.currency}` : "connected");
        setShowVobizModal(false);
        return;
      }
      setVobizNumbers(numData.numbers);
      if (numData.selectedNumber) {
        setVobizSelectedNumber(numData.selectedNumber);
        setSuccess(`Connected! Auto-selected number: ${numData.selectedNumber}`);
        setConnections((prev) => ({ ...prev, vobiz: { connected: true, status: "active" } }));
        setVobizDetail(data.balance ? `balance ${data.balance.amount} ${data.balance.currency} · number ${numData.selectedNumber}` : `connected · number ${numData.selectedNumber}`);
        setShowVobizModal(false);
        return;
      }
      setVobizStep("numbers");
    } catch {
      setError("Network error — please try again");
    } finally {
      setVobizConnecting(false);
    }
  }

  async function handleVobizSelectNumber(e164: string) {
    setVobizConnecting(true);
    try {
      const res = await fetch("/api/v1/integrations/vobiz/numbers/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ numberE164: e164 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to select number");
        return;
      }
      setVobizSelectedNumber(e164);
      setSuccess(`Number ${e164} selected!`);
      setConnections((prev) => ({ ...prev, vobiz: { connected: true, status: "active" } }));
      setVobizDetail(`connected · number ${e164}`);
      setShowVobizModal(false);
    } catch {
      setError("Network error — please try again");
    } finally {
      setVobizConnecting(false);
    }
  }

  async function handleCalendarSetup() {
    setConnecting("google_calendar");
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/v1/calendar/auth-config", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to set up Google Calendar");
        return;
      }
      setNeedsSetup((prev) => ({ ...prev, google_calendar: false }));
      setSuccess(data.message || "Google Calendar is ready to connect.");
      // Immediately start the OAuth connect flow.
      await handleConnect("google_calendar");
    } catch {
      setError("Network error — please try again");
    } finally {
      setConnecting(null);
    }
  }

  async function handleConnect(integration: string) {
    if (integration === "vobiz") {
      await handleVobizCheck();
      return;
    }
    setConnecting(integration);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/composio?action=connect&integration=${integration}&clientId=${encodeURIComponent(tenantId)}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to initiate connection");
        return;
      }
      if (data.needsConfig) {
        // No Composio auth config exists. For Google Calendar we can create
        // it automatically — offer the one-click setup.
        if (integration === "google_calendar") {
          setNeedsSetup((prev) => ({ ...prev, [integration]: true }));
          setError("Google Calendar needs a one-time setup in Composio. Click “Set up Google Calendar” below to create it, then connect.");
        } else {
          setError(data.error || `No auth config found for "${integration}". Create one in the Composio dashboard first.`);
        }
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
        body: JSON.stringify({ action: "disconnect", integration, clientId: tenantId }),
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
          {postPayment
            ? "Connect your accounts to start automating"
            : "Connect your tools — one click via Composio"}
        </p>
      </div>

      {postPayment && (
        <div style={{
          marginBottom: 24, padding: 16, borderRadius: 12,
          background: "rgba(122,154,126,0.08)", border: "1px solid rgba(122,154,126,0.25)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 18 }}>✓</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--green)" }}>Subscription activated</div>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>Connect at least one channel below to begin lead automation.</div>
          </div>
        </div>
      )}

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
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
                    <div style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {app.via ? `${app.category} · ${app.via}` : app.category}
                    </div>
                  </div>
                  {isConnected && <span style={{ fontSize: 11, color: "var(--green)", background: "rgba(122,154,126,0.12)", padding: "4px 8px", borderRadius: 10, border: "1px solid rgba(122,154,126,0.2)" }}>●</span>}
                </div>

                <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{app.desc}</div>

                {isConnected && status?.accountEmail && (
                  <div style={{ fontSize: 11, color: "var(--text-light)" }}>{status.accountEmail}</div>
                )}
                {app.id === "vobiz" && vobizDetail && (
                  <div style={{ fontSize: 11, color: "var(--text-light)" }}>{vobizDetail}</div>
                )}
                {app.id === "google_calendar" && needsSetup[app.id] && !isConnected && (
                  <button
                    onClick={handleCalendarSetup}
                    disabled={connecting === app.id}
                    style={{
                      width: "100%", padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                      cursor: "pointer", background: "var(--amber)", color: "#fff", border: "1px solid var(--amber)",
                      opacity: connecting === app.id ? 0.5 : 1,
                    }}
                  >
                    {connecting === app.id ? "..." : "Set up Google Calendar"}
                  </button>
                )}

                <button
                  onClick={() => {
                    if (app.id === "vobiz") {
                      if (isConnected) {
                        handleVobizCheck();
                      } else {
                        openVobizModal();
                      }
                    } else if (isConnected) {
                      handleDisconnect(app.id);
                    } else {
                      handleConnect(app.id);
                    }
                  }}
                  disabled={connecting === app.id}
                  style={{
                    marginTop: "auto", width: "100%", padding: "10px 16px", borderRadius: 10, fontSize: 13, fontWeight: 500,
                    cursor: "pointer",
                    background: isConnected && app.id !== "vobiz" ? "var(--surface-2)" : "var(--accent)",
                    color: isConnected && app.id !== "vobiz" ? "var(--text-dim)" : "#fff",
                    border: `1px solid ${isConnected && app.id !== "vobiz" ? "var(--border)" : "var(--accent)"}`,
                    opacity: connecting === app.id ? 0.5 : 1,
                  }}
                >
                  {connecting === app.id ? "..." : app.id === "vobiz" ? (isConnected ? "Check connection" : "Connect") : isConnected ? "Disconnect" : "Connect"}
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

      {showVobizModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(24,27,25,0.58)", backdropFilter: "blur(8px)" }}>
          <div role="dialog" aria-modal="true" aria-labelledby="vobiz-connect-title" style={{ width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "auto", borderRadius: 22, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 28px 90px rgba(0,0,0,.28)" }}>
            <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
                <div>
                  <div style={{ color: "var(--accent)", fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 8 }}>Phone Integration</div>
                  <h2 id="vobiz-connect-title" style={{ margin: 0, fontSize: 22, fontWeight: 500, color: "var(--text)" }}>
                    {vobizStep === "credentials" ? "Connect to Vobiz" : "Select a phone number"}
                  </h2>
                  <p style={{ margin: "8px 0 0", color: "var(--text-dim)", fontSize: 13, lineHeight: 1.6 }}>
                    {vobizStep === "credentials"
                      ? "Enter your Vobiz API credentials from console.vobiz.ai"
                      : "Choose a number to use for outbound calls"}
                  </p>
                </div>
                <button type="button" onClick={() => setShowVobizModal(false)} aria-label="Close" style={{ width: 34, height: 34, flex: "0 0 auto", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-dim)", cursor: "pointer" }}>×</button>
              </div>
            </div>

            <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
              {vobizStep === "credentials" ? (
                <>
                  <label style={{ display: "block" }}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 7 }}>Auth ID</span>
                    <input
                      required
                      value={vobizAuthId}
                      onChange={(e) => setVobizAuthId(e.target.value)}
                      placeholder="Your Vobiz Auth ID"
                      autoFocus
                      style={{ width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", outline: "none" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 7 }}>Auth Token</span>
                    <input
                      required
                      type="password"
                      value={vobizAuthToken}
                      onChange={(e) => setVobizAuthToken(e.target.value)}
                      placeholder="Your Vobiz Auth Token"
                      style={{ width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", outline: "none" }}
                    />
                  </label>
                  {vobizConnecting && <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12 }}>Verifying credentials and fetching numbers…</div>}
                </>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {vobizNumbers.map((num) => (
                    <button
                      key={num.id}
                      onClick={() => handleVobizSelectNumber(num.e164)}
                      disabled={vobizConnecting}
                      style={{
                        width: "100%", padding: "14px 16px", borderRadius: 12, fontSize: 14, fontWeight: 500,
                        cursor: "pointer", textAlign: "left",
                        background: vobizSelectedNumber === num.e164 ? "var(--accent-soft)" : "var(--surface-2)",
                        border: `1px solid ${vobizSelectedNumber === num.e164 ? "var(--accent)" : "var(--border)"}`,
                        color: "var(--text)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 15 }}>{num.e164}</span>
                        <span style={{ fontSize: 11, color: num.voiceEnabled ? "var(--green)" : "var(--text-dim)" }}>
                          {num.voiceEnabled ? "● Voice enabled" : "○ Voice disabled"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: "18px 28px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <button type="button" onClick={() => setShowVobizModal(false)} disabled={vobizConnecting} style={{ border: 0, background: "transparent", color: "var(--text-dim)", fontSize: 12, cursor: vobizConnecting ? "default" : "pointer" }}>Cancel</button>
              {vobizStep === "credentials" && (
                <button
                  type="button"
                  onClick={handleVobizConnect}
                  disabled={vobizConnecting || !vobizAuthId.trim() || !vobizAuthToken.trim()}
                  style={{
                    padding: "11px 22px", border: 0, borderRadius: 10, background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600,
                    cursor: vobizConnecting ? "wait" : "pointer",
                    opacity: vobizConnecting || !vobizAuthId.trim() || !vobizAuthToken.trim() ? 0.65 : 1,
                  }}
                >
                  {vobizConnecting ? "Connecting…" : "Connect"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
