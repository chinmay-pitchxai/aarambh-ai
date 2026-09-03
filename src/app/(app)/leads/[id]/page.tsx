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
    lastCallAt: string | null;
    attemptCount: number;
    reusedFrom: string | null;
    assignedAt: string | null;
  };
  calls: Array<{
    id: string;
    outcome: string;
    durationSec: number;
    summary: string;
    sentiment: string;
    transcript?: Array<{ role: string; text: string }>;
    bant?: Record<string, unknown>;
    recordingUrl?: string;
    startedAt: string;
  }>;
  messages: Array<{
    id: string;
    channel: string;
    direction: string;
    body: string;
    sentAt: string;
  }>;
  bookings: Array<{
    id: string;
    scheduledAt: string;
    durationMin: number;
    status: string;
    meetingUrl?: string;
    notes?: string;
  }>;
  retries: Array<{
    id: string;
    attempt: number;
    reason: string;
    nextAttemptAt: string;
  }>;
  insights: {
    summary: string;
    nextStep: { title: string; reason: string; action: string };
    generatedBy: "ai" | "rules";
  };
}

interface TimelineEvent {
  id: string;
  type: "call" | "message" | "booking" | "retry";
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
  recordingUrl?: string;
  bookingStatus?: string;
  scheduledAt?: Date;
  retryAttempt?: number;
  retryStatus?: string;
}

function getTalkingPoints(lead: LeadDetail["lead"], calls: LeadDetail["calls"], messages: LeadDetail["messages"]): string[] {
  const points: string[] = [];
  
  const latestCall = calls[0];
  if (latestCall?.bant && typeof latestCall.bant === "object") {
    const bant = latestCall.bant as Record<string, string>;
    if (bant.budget === "yes") points.push("Budget confirmed — they have budget allocated");
    if (bant.authority === "yes") points.push("Decision maker — can sign off");
    if (bant.need === "yes") points.push("Clear need identified");
    if (bant.timeline && bant.timeline !== "none") points.push(`Timeline: ${bant.timeline}`);
  }

  const sentiments = calls.filter((c) => c.sentiment).map((c) => c.sentiment);
  if (sentiments.length > 0) {
    const positive = sentiments.filter((s) => s === "positive").length;
    const negative = sentiments.filter((s) => s === "negative").length;
    if (positive > negative) points.push("Positive sentiment trend — they're engaged");
    else if (negative > positive) points.push("Negative sentiment — address objections first");
  }

  const objections: string[] = [];
  calls.forEach((c) => {
    if (c.transcript) {
      c.transcript.forEach((t) => {
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
    points.push(`Key objection: "${objections[0]}..."`);
  }

  const recentMsg = messages[0];
  if (recentMsg && recentMsg.direction === "inbound") {
    points.push("They replied recently — high intent");
  }

  if (calls.length === 0 && messages.length === 0) {
    points.push("First contact — establish rapport, discover pain points");
  }

  return points.length > 0 ? points : ["Review their profile, prepare discovery questions"];
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

function formatDuration(sec: number): string {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"timeline" | "calls" | "messages" | "bookings">("timeline");

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

  const { lead, calls, messages, bookings, retries, insights } = data;

  const timeline: TimelineEvent[] = [
    ...calls.map((c) => ({
      id: c.id,
      type: "call" as const,
      date: new Date(c.startedAt),
      outcome: c.outcome,
      summary: c.summary || "Call completed",
      transcript: c.transcript,
      sentiment: c.sentiment,
      durationSec: c.durationSec,
      bant: c.bant,
      recordingUrl: c.recordingUrl,
    })),
    ...messages.map((m) => ({
      id: m.id,
      type: "message" as const,
      date: new Date(m.sentAt),
      channel: m.channel,
      direction: m.direction,
      body: m.body,
      summary: m.body?.slice(0, 100) + "..." || "Message",
    })),
    ...bookings.map((b) => ({
      id: b.id,
      type: "booking" as const,
      date: new Date(b.scheduledAt),
      summary: `Meeting ${b.status} — ${b.durationMin || 30}min${b.meetingUrl ? ` (${b.meetingUrl})` : ""}`,
      bookingStatus: b.status,
      scheduledAt: new Date(b.scheduledAt),
    })),
    ...retries.map((r) => ({
      id: r.id,
      type: "retry" as const,
      date: new Date(r.nextAttemptAt),
      summary: r.reason,
      retryAttempt: r.attempt,
      retryStatus: "scheduled",
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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={`badge badge-${lead.band || "cold"}`} style={{ fontSize: 12 }}>{lead.band || "cold"}</span>
            <span style={{ fontSize: 12, color: "var(--text-dim)", background: "var(--surface-2)", padding: "4px 10px", borderRadius: 20 }}>{lead.status || "new"}</span>
            {lead.score != null && (
              <span style={{ fontSize: 12, color: "var(--accent)", background: "var(--accent-soft)", padding: "4px 10px", borderRadius: 20, fontWeight: 600 }}>Score {lead.score}</span>
            )}
          </div>
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: 14 }}>{lead.company} · {lead.industry} · {lead.city}</p>
        {(lead.reusedFrom || lead.assignedAt) && (
          <p style={{ color: "var(--text-light)", fontSize: 12, marginTop: 4 }}>
            {lead.reusedFrom && <span>Reused from previous client · </span>}
            {lead.assignedAt && <span>Assigned {new Date(lead.assignedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>}
          </p>
        )}
      </div>

      <div className="glow-card" style={{ marginBottom: 24, background: "var(--accent-soft)", border: "1px solid var(--accent)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 16 }}>
          Talking Points for Next Conversation
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
            {calls.reduce((s, c) => s + (c.durationSec || 0), 0) > 0 
              ? `${Math.round(calls.reduce((s, c) => s + (c.durationSec || 0), 0) / 60)}m` 
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

      {insights && (
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr .85fr", gap: 16, marginBottom: 24 }}>
          <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)" }}>Lead Summary</div>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 10, padding: "3px 7px", letterSpacing: ".06em" }}>AI</span>
            </div>
            <p style={{ margin: 0, color: "var(--text)", fontSize: 13, lineHeight: 1.65 }}>{insights.summary}</p>
          </div>
          <div style={{ background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: 16, padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 8 }}>Recommended Next Step</div>
            <div style={{ fontSize: 14, fontWeight: 650, color: "var(--text)", marginBottom: 6 }}>{insights.nextStep.title}</div>
            <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>{insights.nextStep.reason}</p>
            <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}><span style={{ color: "var(--accent)", fontWeight: 700 }}>→</span> {insights.nextStep.action}</div>
          </div>
        </div>
      )}

      {retries.length > 0 && (
        <div className="glow-card" style={{ marginBottom: 24, border: "1px solid var(--c17c60)", background: "var(--warm)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c17c60)", marginBottom: 12 }}>
            Pending Actions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {retries.map((r) => (
              <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13, color: "var(--text)" }}>
                <span style={{ fontWeight: 600 }}>Retry #{r.attempt}</span>
                <span style={{ color: "var(--text-dim)" }}>—</span>
                <span>{r.reason}</span>
                <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 12 }}>
                  Next: {new Date(r.nextAttemptAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 24 }}>
        {([
          { key: "timeline" as const, label: "Timeline" },
          { key: "calls" as const, label: `Calls (${calls.length})` },
          { key: "messages" as const, label: `Messages (${messages.length})` },
          { key: "bookings" as const, label: `Meetings (${bookings.length})` },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSection(tab.key)}
            style={{
              background: "none", border: "none", padding: "10px 16px", fontSize: 12, fontWeight: 500,
              letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
              color: activeSection === tab.key ? "var(--accent)" : "var(--text-dim)",
              borderBottom: activeSection === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSection === "timeline" && (
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
                  : event.type === "booking"
                    ? "badge-booked"
                    : event.type === "retry"
                      ? "badge-cold"
                      : (event.channel === "whatsapp" ? "badge-booked" : "badge-cold");
                
                return (
                  <div key={event.id} style={{ position: "relative", paddingLeft: 24, marginBottom: 24 }}>
                    <div style={{
                      position: "absolute", left: -24, top: 2, width: 20, height: 20, borderRadius: "50%",
                      background: event.type === "call" 
                        ? (event.outcome === "booked" ? "var(--accent)" : event.outcome === "not_interested" ? "var(--terracotta)" : "var(--c17c60)")
                        : event.type === "booking"
                          ? "var(--green)"
                          : event.type === "retry"
                            ? "var(--text-dim)"
                            : (event.channel === "whatsapp" ? "var(--green)" : "var(--cyan)"),
                      border: "3px solid var(--surface)", boxShadow: "0 0 0 2px var(--border)", zIndex: 1,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {event.type === "call" ? (
                        <svg width="10" height="10" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round"/>
                        </svg>
                      ) : event.type === "booking" ? (
                        <svg width="10" height="10" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                      ) : event.type === "retry" ? (
                        <svg width="10" height="10" fill="none" stroke="#fff" strokeWidth="2" viewBox="0 0 24 24">
                          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
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
                          {event.type === "call" ? event.outcome : event.type === "booking" ? `meeting ${event.bookingStatus}` : event.type === "retry" ? `retry #${event.retryAttempt}` : event.channel}
                        </span>
                        {event.type === "call" && event.durationSec && (
                          <span style={{ fontSize: 11, color: "var(--text-light)", background: "var(--surface-2)", padding: "2px 8px", borderRadius: 10 }}>
                            {formatDuration(event.durationSec)}
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

                      {event.type === "call" && event.recordingUrl && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6 }}>Recording</div>
                          <audio controls src={event.recordingUrl} style={{ width: "100%", height: 36, borderRadius: 8 }} />
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
      )}

      {activeSection === "calls" && (
        <div className="glow-card">
          <h3 style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)", marginBottom: 20 }}>Call History</h3>
          {calls.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-light)", fontSize: 13 }}>No calls yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {calls.map((call) => (
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
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6 }}>Call Recording</div>
                      <audio controls src={call.recordingUrl} style={{ width: "100%", height: 36, borderRadius: 8 }} />
                    </div>
                  )}
                  {call.transcript && call.transcript.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <button
                        onClick={() => setExpandedCall(expandedCall === call.id ? null : call.id)}
                        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 14px", fontSize: 11, color: "var(--accent)", cursor: "pointer" }}
                      >
                        {expandedCall === call.id ? "▲ Hide transcript" : "▼ Show transcript"}
                      </button>
                      {expandedCall === call.id && (
                        <div style={{ marginTop: 10, padding: 14, background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)", fontSize: 12, lineHeight: 1.55, maxHeight: 300, overflow: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
                          {call.transcript.map((turn, i) => (
                            <div key={i} style={{ padding: 8, background: turn.role === "agent" ? "var(--accent-soft)" : "var(--warm)", borderRadius: 8 }}>
                              <span style={{ fontWeight: 600, color: turn.role === "agent" ? "var(--accent)" : "var(--terracotta)", textTransform: "capitalize", fontSize: 11 }}>{turn.role === "agent" ? "You" : "Prospect"}</span>
                              <span style={{ marginLeft: 8, color: "var(--text)" }}>{turn.text}</span>
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
        </div>
      )}

      {activeSection === "messages" && (
        <div className="glow-card">
          <h3 style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)", marginBottom: 20 }}>Messages</h3>
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-light)", fontSize: 13 }}>No messages yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {messages.map((msg) => {
                const isWhatsApp = msg.channel === "whatsapp";
                const channelColor = isWhatsApp ? "var(--green)" : "var(--terracotta)";
                return (
                  <div
                    key={msg.id}
                    style={{
                      background: msg.direction === "outbound" ? "var(--accent-soft)" : "var(--surface-2)",
                      borderRadius: 12, padding: 14,
                      border: `1px solid ${msg.direction === "outbound" ? "var(--accent)" : "var(--border)"}`,
                      borderLeft: `3px solid ${channelColor}`,
                      marginLeft: msg.direction === "outbound" ? 40 : 0,
                      marginRight: msg.direction === "inbound" ? 40 : 0,
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: msg.direction === "outbound" ? "var(--accent)" : "var(--terracotta)" }}>
                        {msg.direction === "outbound" ? "→ You" : "← Prospect"}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 500, color: channelColor, background: "var(--surface)", padding: "2px 8px", borderRadius: 10, border: `1px solid ${channelColor}33` }}>
                        {isWhatsApp ? "WhatsApp" : "Gmail"}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-light)", marginLeft: "auto" }}>{new Date(msg.sentAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text)", margin: 0, lineHeight: 1.5 }}>{msg.body}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeSection === "bookings" && (
        <div className="glow-card">
          <h3 style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)", marginBottom: 20 }}>Meetings & Bookings</h3>
          {bookings.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-light)", fontSize: 13 }}>No meetings booked yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {bookings.map((booking) => (
                <div key={booking.id} style={{ background: "var(--surface-2)", borderRadius: 12, padding: 16, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <span className={`badge badge-booked`} style={{ fontSize: 11 }}>{booking.status}</span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{booking.durationMin || 30}min</span>
                    <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: "auto" }}>
                      {new Date(booking.scheduledAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {booking.meetingUrl && (
                    <div style={{ marginTop: 8 }}>
                      <a href={booking.meetingUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
                        {booking.meetingUrl}
                      </a>
                    </div>
                  )}
                  {booking.notes && (
                    <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "8px 0 0", lineHeight: 1.5 }}>{booking.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
