"use client";

import { useEffect, useState } from "react";

interface LeadDetail {
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
    icpTags: string[] | null;
  };
  calls: Array<{
    id: string;
    outcome: string;
    durationSec: number;
    summary: string;
    sentiment: string;
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

interface TimelineEvent {
  id: string;
  type: "call" | "message";
  date: Date;
  channel?: string;
  direction?: string;
  outcome?: string;
  summary: string;
  body?: string;
  transcript?: Array<{ role: string; text: string }>;
  sentiment?: string;
  durationSec?: number;
  bant?: Record<string, unknown>;
}

function getTalkingPoints(lead: any, calls: any[], messages: any[]): string[] {
  const points: string[] = [];
  
  const latestCall = calls[0];
  if (latestCall?.bant && typeof latestCall.bant === "object") {
    const bant = latestCall.bant as Record<string, string>;
    if (bant.budget === "yes") points.push("✅ Budget confirmed — they have budget allocated");
    if (bant.authority === "yes") points.push("✅ Decision maker — can sign off");
    if (bant.need === "yes") points.push("✅ Clear need identified");
    if (bant.timeline && bant.timeline !== "none") points.push(`⏰ Timeline: ${bant.timeline}`);
  }

  const sentiments = calls.filter((c: any) => c.sentiment).map((c: any) => c.sentiment as string);
  if (sentiments.length > 0) {
    const positive = sentiments.filter((s: string) => s === "positive").length;
    const negative = sentiments.filter((s: string) => s === "negative").length;
    if (positive > negative) points.push("📈 Positive sentiment trend — they're engaged");
    else if (negative > positive) points.push("⚠️ Negative sentiment — address objections first");
  }

  const objections: string[] = [];
  calls.forEach((c: any) => {
    if (c.transcript) {
      c.transcript.forEach((t: any) => {
        if (t.role === "prospect" && (t.text.toLowerCase().includes("not interested") || 
            t.text.toLowerCase().includes("too expensive") || 
            t.text.toLowerCase().includes("no budget") ||
            t.text.toLowerCase().includes("not now"))) {
          objections.push(t.text.slice(0, 100));
        }
      });
    }
  });
  if (objections.length > 0) {
    points.push(`🎯 Key objection: "${objections[0]}..."`);
  }

  const recentMsg = messages[0];
  if (recentMsg && recentMsg.direction === "inbound") {
    points.push("💬 They replied recently — high intent");
  }

  if (calls.length === 0 && messages.length === 0) {
    points.push("🆕 First contact — establish rapport, discover pain points");
  }

  return points.length > 0 ? points : ["📋 Review their profile, prepare discovery questions"];
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetch(`/api/leads/${params.id}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Lead not found" : `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message || "Failed to load lead");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [params.id]);

  if (loading) {
    return <div style={{ padding: 40, color: "var(--text-light)", letterSpacing: "0.06em", fontSize: 13, textTransform: "uppercase" }}>Loading lead —</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2 style={{ color: "var(--terracotta)", fontWeight: 300 }}>{error === "Lead not found" ? "Lead not found" : "Failed to load"}</h2>
        <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 8 }}>{error !== "Lead not found" ? error : `No lead with id ${params.id}`}</p>
      </div>
    );
  }

  if (!data || !data.lead) {
    return <div style={{ padding: 40, color: "var(--text-dim)" }}>Lead not found</div>;
  }

  const { lead, calls, messages } = data;

  const timeline: TimelineEvent[] = [
    ...calls.map((c: any) => ({
      id: c.id,
      type: "call" as const,
      date: new Date(c.startedAt),
      outcome: c.outcome,
      summary: c.summary || "Call completed",
      transcript: c.transcript,
      sentiment: c.sentiment,
      durationSec: c.durationSec,
      bant: c.bant,
    })),
    ...messages.map((m: any) => ({
      id: m.id,
      type: "message" as const,
      date: new Date(m.sentAt),
      channel: m.channel,
      direction: m.direction,
      body: m.body,
      summary: m.body?.slice(0, 100) + "..." || "Message",
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const talkingPoints = getTalkingPoints(lead, calls, messages);

  return (
    <div style={{ maxWidth: "1200px" }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: "0.02em", margin: 0 }}>
              {lead.firstName} {lead.lastName}
            </h1>
            <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 4, letterSpacing: "0.02em" }}>
              {lead.title} {lead.company ? `at ${lead.company}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span className={`badge badge-${lead.band || "cold"}`} style={{ fontSize: 12 }}>{lead.band || "cold"}</span>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{lead.status || "new"}</span>
          </div>
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: 14 }}>{lead.company} · {lead.industry} · {lead.city}</p>
      </div>

      <div className="glow-card" style={{ marginBottom: 24, background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 16 }}>
          🎯 Talking Points for Next Conversation
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 8 }}>
          {talkingPoints.map((point, i) => (
            <li key={i} style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.6, listStyle: "none", position: "relative", paddingLeft: 20 }}>
              <span style={{ position: "absolute", left: 0, color: "var(--accent)" }}>→</span>
              {point}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
        <div className="stat-card" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
          <div className="stat-label">Total Calls</div>
          <div className="stat-value" style={{ color: "var(--accent)" }}>{calls.length}</div>
        </div>
        <div className="stat-card" style={{ background: "var(--warm)" }}>
          <div className="stat-label">Messages</div>
          <div className="stat-value">{messages.length}</div>
        </div>
        <div className="stat-card" style={{ background: "var(--warm)" }}>
          <div className="stat-label">Total Duration</div>
          <div className="stat-value">
            {calls.reduce((s: number, c: any) => s + (c.durationSec || 0), 0) > 0 
              ? `${Math.round(calls.reduce((s: number, c: any) => s + (c.durationSec || 0), 0) / 60)}m` 
              : "—"}
          </div>
        </div>
        <div className="stat-card" style={{ background: "var(--warm)" }}>
          <div className="stat-label">Last Touch</div>
          <div className="stat-value" style={{ fontSize: 20 }}>
            {timeline[0] ? formatTimeAgo(timeline[0].date) : "Never"}
          </div>
        </div>
      </div>

      <div className="glow-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>Conversation Timeline</h3>
          <span style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.04em" }}>{timeline.length} events</span>
        </div>

        {timeline.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-light)" }}>
            <svg width="48" height="48" fill="none" stroke="var(--text-light)" strokeWidth="1.3" viewBox="0 0 24 24" style={{ margin: "0 auto 16px" }}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p style={{ fontSize: 14 }}>No conversation history yet</p>
            <p style={{ fontSize: 12, color: "var(--text-light)", marginTop: 4 }}>Start the pipeline to see calls & messages here</p>
          </div>
        ) : (
          <div style={{ position: "relative", paddingLeft: 24 }}>
            <div style={{
              position: "absolute", left: 10, top: 0, bottom: 0, width: 2,
              background: "linear-gradient(to bottom, var(--accent), var(--terracotta), var(--border))",
            }} />
            {timeline.map((event) => {
              const badgeClass = event.type === "call"
                ? (event.outcome === "booked" ? "badge-booked" : event.outcome === "not_interested" ? "badge-parked" : "badge-warm")
                : (event.channel === "whatsapp" ? "badge-booked" : "badge-cold");
              
              return (
                <div key={event.id} style={{ position: "relative", paddingLeft: 24, marginBottom: 24 }}>
                  <div style={{
                    position: "absolute", left: -24, top: 2, width: 20, height: 20, borderRadius: "50%",
                    background: event.type === "call" 
                      ? (event.outcome === "booked" ? "var(--accent)" : event.outcome === "not_interested" ? "var(--terracotta)" : "var(--c17c60)")
                      : (event.channel === "whatsapp" ? "var(--green)" : "var(--cyan)"),
                    border: "3px solid var(--surface)", boxShadow: "0 0 0 2px var(--border)", zIndex: 1,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {event.type === "call" ? (
                      <svg width="10" height="10" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <svg width="10" height="10" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    )}
                  </div>

                  <div className="glow-card" style={{ padding: 20, background: "var(--surface)" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                      <span className={`badge ${badgeClass}`} style={{ fontSize: 11 }}>
                        {event.type === "call" ? event.outcome : event.channel}
                      </span>
                      {event.type === "call" && event.durationSec && (
                        <span style={{ fontSize: 11, color: "var(--text-light)", background: "var(--surface-2)", padding: "2px 8px", borderRadius: 10 }}>
                          {Math.floor(event.durationSec / 60)}m {event.durationSec % 60}s
                        </span>
                      )}
                      {event.sentiment && (
                        <span style={{ fontSize: 11, color: event.sentiment === "positive" ? "var(--green)" : event.sentiment === "negative" ? "var(--terracotta)" : "var(--text-light)" }}>
                          {event.sentiment}
                        </span>
                      )}
                      {event.type === "message" && (
                        <span style={{ fontSize: 11, color: "var(--text-light)", background: "var(--surface-2)", padding: "2px 8px", borderRadius: 10 }}>
                          {event.direction}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: "auto" }}>
                        {event.date.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    <p style={{ fontSize: 13, color: "var(--text)", margin: 0, lineHeight: 1.6, letterSpacing: "0.01em" }}>
                      {event.summary || event.body || "—"}
                    </p>

                    {event.type === "call" && event.bant && typeof event.bant === "object" && (
                      <div style={{ display: "flex", gap: 12, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                        {Object.entries(event.bant).map(([k, v]) => {
                          const val = typeof v === "string" ? v : typeof v === "number" ? String(v) : v === undefined ? "" : String(v);
                          return (
                            <span key={k} style={{ fontSize: 11, color: "var(--text-dim)", background: "var(--surface-2)", padding: "4px 10px", borderRadius: 8 }}>
                              {k}: {val}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {event.type === "call" && event.transcript && event.transcript.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <button
                          onClick={() => setExpandedCall(expandedCall === event.id ? null : event.id)}
                          style={{
                            background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8,
                            padding: "8px 16px", fontSize: 12, color: "var(--accent)", cursor: "pointer",
                            display: "flex", alignItems: "center", gap: 8,
                          }}
                        >
                          {expandedCall === event.id ? "▲ Hide transcript" : "▼ Show full transcript"}
                        </button>
                        {expandedCall === event.id && event.transcript && (
                          <div style={{ marginTop: 12, padding: 16, background: "var(--surface-2)", borderRadius: 10, border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.7, maxHeight: 300, overflow: "auto" }}>
                            {event.transcript.map((t, i) => (
                              <div key={i} style={{ marginBottom: 8, padding: 8, background: t.role === "agent" ? "var(--accent-soft)" : "var(--warm)", borderRadius: 8 }}>
                                <span style={{ fontWeight: 600, color: t.role === "agent" ? "var(--accent)" : "var(--terracotta)", textTransform: "capitalize", fontSize: 11 }}>
                                  {t.role === "agent" ? "You" : "Prospect"}
                                </span>
                                <span style={{ marginLeft: 8, color: "var(--text)" }}>{t.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}