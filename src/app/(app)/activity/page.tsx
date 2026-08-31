"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

interface Activity {
  id: string;
  type: "call" | "message";
  leadId: string;
  clientId: string;
  outcome?: string;
  durationSec?: number;
  summary?: string;
  sentiment?: string;
  channel?: string;
  direction?: string;
  body?: string;
  recordingUrl?: string;
  timestamp: string;
  leadFirstName?: string | null;
  leadLastName?: string | null;
  leadCompany?: string | null;
  leadBand?: string | null;
  leadScore?: number | null;
}

function groupByDate(items: Activity[]): Record<string, Activity[]> {
  const groups: Record<string, Activity[]> = {};
  for (const item of items) {
    const d = item.timestamp ? new Date(item.timestamp) : new Date();
    const key = d.toDateString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatDuration(sec: number | undefined) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function leadName(a: Activity) {
  const first = a.leadFirstName || "";
  const last = a.leadLastName || "";
  return `${first} ${last}`.trim() || a.leadId.slice(0, 8);
}

export default function ActivityPage() {
  const [activity, setActivity] = useState<Activity[]>([]);
  const [totalCalls, setTotalCalls] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [filter, setFilter] = useState<"all" | "call" | "message">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetch("/api/activity?limit=50", { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        setActivity(d.activity || []);
        setTotalCalls(d.totalCalls || 0);
        setTotalMessages(d.totalMessages || 0);
      })
      .catch((e) => { if (e.name !== "AbortError") setError(e.message || "Failed to load"); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  const filtered = filter === "all" ? activity : activity.filter((a) => a.type === filter);
  const grouped = useMemo(() => groupByDate(filtered), [filtered]);
  const dateKeys = Object.keys(grouped);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: "0.02em", margin: 0 }}>Activity Feed</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 6, letterSpacing: "0.02em" }}>
          Every call and message — beautifully tracked
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 28 }}>
        {[
          { label: "All", value: activity.length, color: "var(--text)", bg: "var(--surface)" },
          { label: "Calls", value: totalCalls, color: "var(--accent)", bg: "var(--accent-soft)" },
          { label: "Messages", value: totalMessages, color: "var(--terracotta)", bg: "var(--terracotta-soft)" },
        ].map((s) => (
          <div
            key={s.label}
            onClick={() => setFilter(s.label.toLowerCase() as typeof filter)}
            style={{
              background: filter === (s.label.toLowerCase()) ? s.bg : "var(--surface)",
              border: `1px solid ${filter === (s.label.toLowerCase()) ? s.color : "var(--border)"}`,
              borderRadius: 14, padding: "16px 20px", cursor: "pointer",
              transition: "all 0.15s",
              boxShadow: filter === (s.label.toLowerCase()) ? `0 2px 12px ${s.color}15` : "none",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 300, color: s.color, letterSpacing: "0.02em" }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 4, fontWeight: 500 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        {(["all", "call", "message"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            style={{
              padding: "7px 16px", borderRadius: 20, fontSize: 12, fontWeight: 500, letterSpacing: "0.04em",
              cursor: "pointer", border: `1px solid ${filter === tab ? "var(--accent)" : "var(--border)"}`,
              background: filter === tab ? "var(--accent)" : "var(--surface)", color: filter === tab ? "#fff" : "var(--text-dim)",
              transition: "all 0.15s",
            }}
          >
            {tab === "all" ? "All" : tab === "call" ? "Calls" : "Messages"}
            <span style={{ marginLeft: 5, opacity: 0.7, fontSize: 11 }}>
              {tab === "all" ? activity.length : tab === "call" ? totalCalls : totalMessages}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-light)", letterSpacing: "0.06em", fontSize: 13, textTransform: "uppercase" }}>Loading activity —</div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: "center" }}>
          <h3 style={{ color: "var(--terracotta)", fontWeight: 300 }}>Failed to load</h3>
          <p style={{ color: "var(--text-dim)", fontSize: 13 }}>{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20,
          textAlign: "center", padding: 80,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: "var(--surface-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px", border: "1px solid var(--border)",
          }}>
            <svg width="24" height="24" fill="none" stroke="var(--text-light)" strokeWidth="1.3" viewBox="0 0 24 24">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h3 style={{ color: "var(--text)", fontWeight: 400, letterSpacing: "0.04em", fontSize: 16 }}>
            {filter === "all" ? "No activity yet" : filter === "call" ? "No calls yet" : "No messages yet"}
          </h3>
          <p style={{ color: "var(--text-light)", fontSize: 13, marginTop: 8, letterSpacing: "0.02em" }}>
            {filter === "all" ? "Start the pipeline to see calls and messages here" : "Try switching to All to see everything"}
          </p>
        </div>
      ) : (
        <div>
          {dateKeys.map((date, di) => {
            const items = grouped[date];
            return (
              <div key={date} style={{ marginBottom: 36 }}>
                {/* Date header */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: 4,
                    background: di === 0 ? "var(--accent)" : "var(--border)",
                  }} />
                  <span style={{
                    fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                    color: di === 0 ? "var(--accent)" : "var(--text-light)", fontWeight: 600,
                  }}>
                    {dateLabel(date)}
                  </span>
                  <span style={{
                    fontSize: 11, color: "var(--text-light)", background: "var(--surface-2)",
                    padding: "2px 10px", borderRadius: 10,
                  }}>
                    {items.length} {items.length === 1 ? "event" : "events"}
                  </span>
                  <div style={{ flex: 1, height: 1, background: "var(--border)", marginLeft: 4 }} />
                </div>

                {/* Timeline */}
                <div style={{ position: "relative", paddingLeft: 28 }}>
                  {/* Vertical line */}
                  <div style={{
                    position: "absolute", left: 11, top: 0, bottom: 0, width: 2,
                    background: "linear-gradient(to bottom, var(--accent), var(--terracotta), var(--border))",
                    borderRadius: 1,
                  }} />

                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {items.map((item) => {
                      const isCall = item.type === "call";
                      const isWhatsApp = item.channel === "whatsapp";
                      const isGmail = item.channel === "gmail";

                      const dotColor = isCall
                        ? item.outcome === "booked" ? "var(--accent)"
                          : item.outcome === "not_interested" ? "var(--terracotta)"
                          : "var(--amber)"
                        : isWhatsApp ? "var(--green)" : "var(--terracotta)";

                      const bandColor = item.leadBand === "hot" ? "var(--terracotta)"
                        : item.leadBand === "warm" ? "var(--amber)" : "var(--accent)";

                      return (
                        <div key={item.id} style={{ position: "relative", paddingLeft: 24 }}>
                          {/* Timeline dot */}
                          <div style={{
                            position: "absolute", left: -28, top: 6,
                            width: 18, height: 18, borderRadius: "50%",
                            background: dotColor, border: "3px solid var(--bg)",
                            boxShadow: `0 0 0 2px ${dotColor}44`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            zIndex: 1,
                          }}>
                            {isCall ? (
                              <svg width="8" height="8" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24">
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                              </svg>
                            ) : isWhatsApp ? (
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                            ) : (
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                            )}
                          </div>

                          {/* Card */}
                          <div style={{
                            background: "var(--surface)", border: "1px solid var(--border)",
                            borderRadius: 14, padding: "16px 18px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                            transition: "border-color 0.15s, box-shadow 0.15s",
                          }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = dotColor; e.currentTarget.style.boxShadow = `0 2px 12px ${dotColor}15`; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; }}
                          >
                            {/* Top row: type + lead + time */}
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                              {/* Type icon + label */}
                              <div style={{
                                display: "flex", alignItems: "center", gap: 6,
                                fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                                color: isCall ? "var(--accent)" : isWhatsApp ? "var(--green)" : "var(--terracotta)",
                              }}>
                                {isCall ? (
                                  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
                                  </svg>
                                ) : isWhatsApp ? (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                                ) : (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                                )}
                                {isCall ? "Call" : isWhatsApp ? "WhatsApp" : "Gmail"}
                              </div>

                              {/* Outcome / direction */}
                              {isCall && item.outcome && (
                                <span className={`badge badge-${item.outcome === "booked" ? "booked" : item.outcome === "not_interested" ? "parked" : "warm"}`} style={{ fontSize: 10, padding: "3px 8px" }}>
                                  {item.outcome.replace("_", " ")}
                                </span>
                              )}
                              {!isCall && item.direction && (
                                <span style={{
                                  fontSize: 10, fontWeight: 500, letterSpacing: "0.04em",
                                  color: item.direction === "outbound" ? "var(--accent)" : "var(--terracotta)",
                                  background: item.direction === "outbound" ? "var(--accent-soft)" : "var(--terracotta-soft)",
                                  padding: "3px 8px", borderRadius: 10,
                                }}>
                                  {item.direction === "outbound" ? "→ Sent" : "← Received"}
                                </span>
                              )}

                              {/* Duration */}
                              {isCall && item.durationSec != null && item.durationSec > 0 && (
                                <span style={{
                                  fontSize: 10, color: "var(--text-dim)", background: "var(--surface-2)",
                                  padding: "3px 8px", borderRadius: 10,
                                }}>
                                  {formatDuration(item.durationSec)}
                                </span>
                              )}

                              {/* Sentiment */}
                              {isCall && item.sentiment && (
                                <span style={{
                                  fontSize: 10, fontWeight: 500,
                                  color: item.sentiment === "positive" ? "var(--green)" : item.sentiment === "negative" ? "var(--terracotta)" : "var(--text-dim)",
                                }}>
                                  {item.sentiment === "positive" ? "↑ Positive" : item.sentiment === "negative" ? "↓ Negative" : "— Neutral"}
                                </span>
                              )}

                              {/* Time */}
                              <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: "auto" }}>
                                {item.timestamp ? new Date(item.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
                              </span>
                            </div>

                            {/* Lead name + company */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <Link
                                href={`/leads/${item.leadId}`}
                                style={{
                                  fontSize: 13, fontWeight: 600, color: "var(--text)", textDecoration: "none",
                                  display: "flex", alignItems: "center", gap: 6,
                                }}
                              >
                                <div style={{
                                  width: 24, height: 24, borderRadius: 7, background: "var(--accent-soft)",
                                  border: `1px solid ${bandColor}44`, display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 10, fontWeight: 700, color: bandColor, flexShrink: 0,
                                }}>
                                  {(item.leadFirstName?.[0] || "") + (item.leadLastName?.[0] || "") || "?"}
                                </div>
                                {leadName(item)}
                              </Link>
                              {item.leadCompany && (
                                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>at {item.leadCompany}</span>
                              )}
                              {item.leadBand && (
                                <span className={`badge badge-${item.leadBand}`} style={{ fontSize: 9, padding: "2px 6px" }}>{item.leadBand}</span>
                              )}
                              {item.leadScore != null && (
                                <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>{item.leadScore}</span>
                              )}
                            </div>

                            {/* Summary / body */}
                            {item.summary && (
                              <p style={{ fontSize: 13, color: "var(--text)", margin: 0, lineHeight: 1.6, letterSpacing: "0.01em" }}>
                                {item.summary}
                              </p>
                            )}
                            {item.body && (
                              <p style={{
                                fontSize: 13, color: "var(--text-dim)", margin: item.summary ? "6px 0 0" : 0,
                                lineHeight: 1.5, fontStyle: "italic",
                                borderLeft: `2px solid ${isWhatsApp ? "var(--green)" : "var(--terracotta)"}33`,
                                paddingLeft: 10,
                              }}>
                                &ldquo;{item.body.length > 200 ? item.body.slice(0, 200) + "..." : item.body}&rdquo;
                              </p>
                            )}

                            {/* Recording */}
                            {isCall && item.recordingUrl && (
                              <div style={{ marginTop: 10 }}>
                                <audio controls src={item.recordingUrl} style={{ width: "100%", height: 32, borderRadius: 8 }} />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
