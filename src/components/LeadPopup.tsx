"use client";

import { useEffect, useState, useCallback } from "react";

interface LeadPopupData {
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    company: string | null;
    title: string | null;
    city: string | null;
    industry: string | null;
    companySize: string | null;
    score: number | null;
    band: string | null;
    status: string | null;
  };
  calls: Array<{
    id: string;
    outcome: string;
    durationSec: number;
    summary: string;
    sentiment: string;
    recordingUrl?: string;
    transcript?: Array<{ role: string; text: string }>;
    bant?: Record<string, unknown>;
    startedAt: string;
  }>;
  messages: Array<{
    id: string;
    channel: string;
    direction: string;
    body: string;
    sentAt: string;
  }>;
}

function formatDuration(sec: number) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTimeAgo(date: Date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getTalkingPoints(calls: LeadPopupData["calls"], messages: LeadPopupData["messages"]) {
  const points: string[] = [];
  const latest = calls[0];
  if (latest?.bant && typeof latest.bant === "object") {
    const b = latest.bant as Record<string, string>;
    if (b.budget === "yes") points.push("Budget confirmed");
    if (b.authority === "yes") points.push("Decision maker");
    if (b.need === "yes") points.push("Clear need identified");
    if (b.timeline && b.timeline !== "none") points.push(`Timeline: ${b.timeline}`);
  }
  const sentiments = calls.filter((c) => c.sentiment).map((c) => c.sentiment);
  if (sentiments.length > 0) {
    const pos = sentiments.filter((s) => s === "positive").length;
    const neg = sentiments.filter((s) => s === "negative").length;
    if (pos > neg) points.push("Positive sentiment trend");
    else if (neg > pos) points.push("Negative sentiment — address objections");
  }
  const objections: string[] = [];
  calls.forEach((c) => {
    c.transcript?.forEach((t) => {
      if (t.role === "prospect" && /not interested|too expensive|no budget|not now/i.test(t.text)) {
        objections.push(t.text.slice(0, 80));
      }
    });
  });
  if (objections.length > 0) points.push(`Key objection: "${objections[0]}"`);
  const lastMsg = messages[0];
  if (lastMsg?.direction === "inbound") points.push("They replied recently — high intent");
  if (calls.length === 0 && messages.length === 0) points.push("First contact — discover pain points");
  return points.length > 0 ? points : ["Review profile, prepare discovery questions"];
}

export default function LeadPopup({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [data, setData] = useState<LeadPopupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "calls" | "messages">("overview");

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/leads/${leadId}`, { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then((d) => { if (d.error) throw new Error(d.error); setData(d); })
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [leadId]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const lead = data?.lead;
  const calls = data?.calls ?? [];
  const messages = data?.messages ?? [];
  const talkingPoints = data ? getTalkingPoints(calls, messages) : [];
  const latestCall = calls[0];
  const timeline = [
    ...calls.map((c) => ({ type: "call" as const, date: new Date(c.startedAt), ...c })),
    ...messages.map((m) => ({ type: "message" as const, date: new Date(m.sentAt), ...m })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

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
          width: "100%", maxWidth: 720, maxHeight: "85vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.25)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          {loading ? (
            <div style={{ color: "var(--text-light)", fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase" }}>Loading —</div>
          ) : error ? (
            <div style={{ color: "var(--terracotta)", fontSize: 13 }}>{error}</div>
          ) : lead ? (
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flex: 1 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: "var(--accent-soft)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, fontWeight: 600, color: "var(--accent)", flexShrink: 0,
              }}>
                {lead.firstName?.[0]}{lead.lastName?.[0] || ""}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>{lead.firstName} {lead.lastName}</div>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>{lead.title} {lead.company ? `at ${lead.company}` : ""}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {lead.band && <span className={`badge badge-${lead.band}`}>{lead.band}</span>}
                  {lead.status && <span style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--surface-2)", padding: "4px 10px", borderRadius: 20 }}>{lead.status}</span>}
                  {lead.score != null && <span style={{ fontSize: 11, color: "var(--accent)", background: "var(--accent-soft)", padding: "4px 10px", borderRadius: 20, fontWeight: 600 }}>Score {lead.score}</span>}
                  {lead.city && <span style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--surface-2)", padding: "4px 10px", borderRadius: 20 }}>{lead.city}</span>}
                </div>
              </div>
            </div>
          ) : null}
          <button
            onClick={onClose}
            style={{
              background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8,
              width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "var(--text-dim)", fontSize: 16, flexShrink: 0, marginLeft: 12,
            }}
          >×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", padding: "0 24px", flexShrink: 0 }}>
          {(["overview", "calls", "messages"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: "none", border: "none", padding: "10px 16px", fontSize: 12, fontWeight: 500,
                letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
                color: activeTab === tab ? "var(--accent)" : "var(--text-dim)",
                borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                transition: "all 0.15s",
              }}
            >
              {tab === "overview" ? "Overview" : tab === "calls" ? `Calls (${calls.length})` : `Messages (${messages.length})`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-light)", fontSize: 13 }}>Loading lead data —</div>
          ) : error ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--terracotta)", fontSize: 13 }}>{error}</div>
          ) : (
            <>
              {/* OVERVIEW TAB */}
              {activeTab === "overview" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {/* Quick stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                    {[
                      { label: "Calls", value: calls.length },
                      { label: "Messages", value: messages.length },
                      { label: "Duration", value: calls.reduce((s, c) => s + (c.durationSec || 0), 0) > 0 ? `${Math.round(calls.reduce((s, c) => s + (c.durationSec || 0), 0) / 60)}m` : "—" },
                      { label: "Last Touch", value: timeline[0] ? formatTimeAgo(timeline[0].date) : "Never" },
                    ].map((s) => (
                      <div key={s.label} style={{ background: "var(--surface-2)", borderRadius: 12, padding: "12px 14px", textAlign: "center" }}>
                        <div style={{ fontSize: 20, fontWeight: 300, color: "var(--text)" }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Talking points */}
                  <div style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 10 }}>Talking Points</div>
                    <ul style={{ margin: 0, paddingLeft: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                      {talkingPoints.map((p, i) => (
                        <li key={i} style={{ fontSize: 13, color: "var(--text)", listStyle: "none", display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ color: "var(--accent)", flexShrink: 0 }}>→</span>{p}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Latest call summary */}
                  {latestCall && (
                    <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 16 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 10 }}>Latest Call Summary</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                        <span className={`badge badge-${latestCall.outcome === "booked" ? "booked" : latestCall.outcome === "not_interested" ? "parked" : "warm"}`} style={{ fontSize: 11 }}>{latestCall.outcome}</span>
                        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{formatDuration(latestCall.durationSec)}</span>
                        {latestCall.sentiment && (
                          <span style={{ fontSize: 11, color: latestCall.sentiment === "positive" ? "var(--green)" : latestCall.sentiment === "negative" ? "var(--terracotta)" : "var(--text-dim)" }}>{latestCall.sentiment}</span>
                        )}
                        <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: "auto" }}>{new Date(latestCall.startedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text)", margin: 0, lineHeight: 1.6 }}>{latestCall.summary || "No summary available"}</p>
                      {latestCall.bant && typeof latestCall.bant === "object" && (
                        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                          {Object.entries(latestCall.bant).map(([k, v]) => (
                            <span key={k} style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--surface)", padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)" }}>{k}: {String(v)}</span>
                          ))}
                        </div>
                      )}
                      {latestCall.recordingUrl && (
                        <div style={{ marginTop: 12 }}>
                          <audio controls src={latestCall.recordingUrl} style={{ width: "100%", height: 36, borderRadius: 8 }} />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Contact */}
                  <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 10 }}>Contact</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {lead?.email && <div style={{ fontSize: 13, color: "var(--text)" }}>✉ {lead.email}</div>}
                      {lead?.phone && <div style={{ fontSize: 13, color: "var(--text)" }}>☎ {lead.phone}</div>}
                      {lead?.industry && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Industry: {lead.industry}</div>}
                      {lead?.companySize && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>Size: {lead.companySize}</div>}
                    </div>
                  </div>
                </div>
              )}

              {/* CALLS TAB */}
              {activeTab === "calls" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {calls.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "var(--text-light)", fontSize: 13 }}>No calls yet</div>
                  ) : calls.map((call) => (
                    <div key={call.id} style={{ background: "var(--surface-2)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                        <span className={`badge badge-${call.outcome === "booked" ? "booked" : call.outcome === "not_interested" ? "parked" : "warm"}`} style={{ fontSize: 11 }}>{call.outcome}</span>
                        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{formatDuration(call.durationSec)}</span>
                        {call.sentiment && (
                          <span style={{ fontSize: 11, color: call.sentiment === "positive" ? "var(--green)" : call.sentiment === "negative" ? "var(--terracotta)" : "var(--text-dim)" }}>{call.sentiment}</span>
                        )}
                        <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: "auto" }}>{new Date(call.startedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p style={{ fontSize: 13, color: "var(--text)", margin: 0, lineHeight: 1.6 }}>{call.summary || "No summary"}</p>
                      {call.bant && typeof call.bant === "object" && (
                        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                          {Object.entries(call.bant).map(([k, v]) => (
                            <span key={k} style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--surface)", padding: "4px 10px", borderRadius: 8, border: "1px solid var(--border)" }}>{k}: {String(v)}</span>
                          ))}
                        </div>
                      )}
                      {call.recordingUrl && (
                        <div style={{ marginTop: 10 }}>
                          <audio controls src={call.recordingUrl} style={{ width: "100%", height: 36, borderRadius: 8 }} />
                        </div>
                      )}
                      {call.transcript && call.transcript.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <button
                            onClick={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
                            style={{
                              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
                              padding: "6px 14px", fontSize: 11, color: "var(--accent)", cursor: "pointer",
                            }}
                          >
                            {expandedCall === call.id ? "▲ Hide transcript" : "▼ Show transcript"}
                          </button>
                          {expandedCall === call.id && (
                            <div style={{ marginTop: 10, padding: 12, background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.7, maxHeight: 240, overflow: "auto" }}>
                              {call.transcript.map((t, i) => (
                                <div key={i} style={{ marginBottom: 6, padding: "6px 8px", background: t.role === "agent" ? "var(--accent-soft)" : "var(--terracotta-soft)", borderRadius: 6 }}>
                                  <span style={{ fontWeight: 600, color: t.role === "agent" ? "var(--accent)" : "var(--terracotta)", textTransform: "capitalize", fontSize: 10 }}>
                                    {t.role === "agent" ? "AI" : "Prospect"}
                                  </span>
                                  <span style={{ marginLeft: 6, color: "var(--text)" }}>{t.text}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* MESSAGES TAB */}
              {activeTab === "messages" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {messages.length === 0 ? (
                    <div style={{ padding: 40, textAlign: "center", color: "var(--text-light)", fontSize: 13 }}>No messages yet</div>
                  ) : (
                    <>
                      {/* Channel filter chips */}
                      <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                        {(() => {
                          const whatsappCount = messages.filter((m) => m.channel === "whatsapp").length;
                          const gmailCount = messages.filter((m) => m.channel === "gmail").length;
                          return (
                            <>
                              <span style={{ fontSize: 11, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 20, padding: "4px 12px", color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                                WhatsApp {whatsappCount}
                              </span>
                              <span style={{ fontSize: 11, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 20, padding: "4px 12px", color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--terracotta)" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                                Gmail {gmailCount}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--text-light)", padding: "4px 0" }}>{messages.length} total</span>
                            </>
                          );
                        })()}
                      </div>

                      {/* Messages list */}
                      {messages.map((msg) => {
                        const isWhatsApp = msg.channel === "whatsapp";
                        const channelColor = isWhatsApp ? "var(--green)" : "var(--terracotta)";
                        const channelBg = isWhatsApp ? "rgba(122,154,126,0.08)" : "rgba(193,124,96,0.08)";
                        return (
                          <div
                            key={msg.id}
                            style={{
                              background: msg.direction === "outbound" ? "var(--accent-soft)" : channelBg,
                              borderRadius: 12, padding: 14,
                              border: `1px solid ${msg.direction === "outbound" ? "var(--accent)" : "var(--border)"}`,
                              borderLeft: `3px solid ${channelColor}`,
                              marginLeft: msg.direction === "outbound" ? 40 : 0,
                              marginRight: msg.direction === "inbound" ? 40 : 0,
                            }}
                          >
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                              {/* Channel icon */}
                              {isWhatsApp ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--terracotta)" strokeWidth="2" style={{ flexShrink: 0 }}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                              )}
                              <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: msg.direction === "outbound" ? "var(--accent)" : "var(--terracotta)" }}>
                                {msg.direction === "outbound" ? "→ You" : "← Prospect"}
                              </span>
                              <span style={{ fontSize: 10, fontWeight: 500, color: channelColor, background: msg.direction === "outbound" ? "var(--surface)" : "var(--surface)", padding: "2px 8px", borderRadius: 10, border: `1px solid ${channelColor}33` }}>
                                {isWhatsApp ? "WhatsApp" : "Gmail"}
                              </span>
                              <span style={{ fontSize: 10, color: "var(--text-light)", marginLeft: "auto" }}>{new Date(msg.sentAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            <p style={{ fontSize: 13, color: "var(--text)", margin: 0, lineHeight: 1.5 }}>{msg.body}</p>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
