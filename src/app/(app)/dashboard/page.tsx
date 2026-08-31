"use client";

import { useEffect, useState, useMemo } from "react";
import { LineChart, MultiLineChart, StackedAreaChart, Heatmap, BarChart, GaugeChart, KPICard, groupByDate, groupByDateAndCategory } from "@/components/Charts";

interface Stats {
  pipeline: Record<string, number>;
  bands: Record<string, number>;
  totalLeads: number;
  activeRetries: number;
  today: {
    callsMade: number;
    meetingsBooked: number;
    costApollo: number;
    costVobiz: number;
  };
  recentCalls: Array<{
    id: string;
    outcome: string;
    durationSec: number;
    summary: string;
    sentiment: string;
    startedAt: string;
  }>;
}

interface HistoryData {
  kpi: Array<{
    date: string;
    callsMade: number;
    callsAnswered: number;
    meetingsBooked: number;
    leadsPulled: number;
    leadsReused: number;
    costApollo: number;
    costVobiz: number;
    costGemini: number;
  }>;
  calls: Array<{
    date: string;
    outcome: string;
    durationSec: number;
    sentiment: string;
  }>;
  leads: Array<{
    date: string;
    band: string;
  }>;
}

const PIPELINE_STAGES = [
  { key: "new", label: "New", color: "#8A9A8B" },
  { key: "contacted", label: "Contacted", color: "#C9A86A" },
  { key: "qualified", label: "Qualified", color: "#C17C60" },
  { key: "converted", label: "Converted", color: "#7A9A7E" },
  { key: "parked", label: "Parked", color: "#B0A9A0" },
];

const BAND_COLORS: Record<string, string> = {
  hot: "#C17C60",
  warm: "#C9A86A",
  interested: "#D4A08C",
  cold: "#8A9A8B",
  unscored: "#E8E0D5",
};

function PieChart({ data, colors }: { data: { label: string; value: number }[]; colors: Record<string, string> }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div style={{ width: 180, height: 180, borderRadius: "50%", background: "var(--surface-2)", border: "1px dashed var(--border)" }} />;
  let acc = 0;
  const slices = data.map((d) => {
    const start = acc;
    const angle = (d.value / total) * 360;
    acc += angle;
    const x1 = 80 + 70 * Math.cos((start - 90) * Math.PI / 180);
    const y1 = 80 + 70 * Math.sin((start - 90) * Math.PI / 180);
    const x2 = 80 + 70 * Math.cos((start + angle - 90) * Math.PI / 180);
    const y2 = 80 + 70 * Math.sin((start + angle - 90) * Math.PI / 180);
    const large = angle > 180 ? 1 : 0;
    return { ...d, d: `M80,80 L${x1},${y1} A70,70 0 ${large},1 ${x2},${y2} Z`, color: colors[d.label] || "#E8E0D5" };
  });
  return (
    <svg width="180" height="180" viewBox="0 0 160 160">
      {slices.map((s) => <path key={s.label} d={s.d} fill={s.color} stroke="var(--surface)" strokeWidth="2" />)}
      <circle cx="80" cy="80" r="32" fill="var(--surface)" />
    </svg>
  );
}

function FunnelChart({ stages }: { stages: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {stages.map((s) => {
        const w = max > 0 ? 40 + (s.value / max) * 60 : 40;
        return (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 80, fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.04em", textTransform: "uppercase", textAlign: "right" }}>{s.label}</div>
            <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
              <div style={{ width: `${w}%`, height: 28, background: s.color, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 600, minWidth: 40 }}>
                {s.value}
              </div>
              <div style={{ width: 40, fontSize: 11, color: "var(--text-light)", marginLeft: 8 }}>{max > 0 ? `${Math.round((s.value / max) * 100)}%` : "0%"}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetch("/api/stats", { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setStats)
      .catch((e) => { if (e.name !== "AbortError") setError(e.message || "Failed to load stats"); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/stats/history?days=30", { signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setHistory)
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
        <div style={{ color: "var(--text-light)", letterSpacing: "0.06em", fontSize: 13, textTransform: "uppercase" }}>Loading pipeline —</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <h2 style={{ color: "var(--terracotta)", fontWeight: 300 }}>Failed to load</h2>
        <p style={{ color: "var(--text-dim)", fontSize: 14 }}>{error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <h2 style={{ color: "var(--text)", fontWeight: 300, letterSpacing: "0.04em" }}>No data yet</h2>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 12 }}>
          Run your first pipeline with <code style={{ background: "var(--surface-2)", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}>POST /api/run</code>
        </p>
      </div>
    );
  }

  const totalPipeline = Object.values(stats.pipeline).reduce((a, b) => a + b, 0);
  const totalBands = Object.values(stats.bands).reduce((a, b) => a + b, 0);
  const totalCost = stats.today.costApollo + stats.today.costVobiz;
  const conversionRate = stats.today.callsMade > 0 ? ((stats.today.meetingsBooked / stats.today.callsMade) * 100).toFixed(1) : "0.0";
  const costPerLead = stats.totalLeads > 0 ? (totalCost / stats.totalLeads / 100).toFixed(2) : "0.00";
  const costPerMeeting = stats.today.meetingsBooked > 0 ? (totalCost / stats.today.meetingsBooked / 100).toFixed(2) : "—";
  const hotRate = totalBands > 0 ? Math.round(((stats.bands.hot || 0) / totalBands) * 100) : 0;

  return (
    <div>
      {/* Header */}
      <div className="section-header">
        <h1 style={{ fontSize: 42, fontWeight: 300, lineHeight: 1.15, letterSpacing: "-0.01em" }}>
          Your <span className="swash">Pipeline</span>,<br />Run by <span className="swash">AI</span>
        </h1>
        <p style={{ fontSize: 16, marginTop: 12 }}>Every lead tracked. Nothing leaks. Real-time.</p>
      </div>

      {/* Primary Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 20 }}>
        {[
          { label: "Total Leads", value: stats.totalLeads.toLocaleString(), color: "var(--text)", sub: `${hotRate}% hot leads` },
          { label: "Calls Today", value: stats.today.callsMade, color: "var(--accent)", sub: `${stats.activeRetries} pending retries` },
          { label: "Hot Leads", value: stats.bands.hot || 0, color: "var(--terracotta)", sub: `of ${totalBands} scored` },
          { label: "Meetings Booked", value: stats.today.meetingsBooked, color: "var(--green)", sub: `${conversionRate}% conversion` },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 6, letterSpacing: "0.04em" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Secondary Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 40 }}>
        {[
          { label: "Conversion Rate", value: conversionRate, unit: "%", sub: "meetings / calls" },
          { label: "Cost per Lead", value: `₹${costPerLead}`, unit: "", sub: "blended sourcing + calling" },
          { label: "Cost per Meeting", value: costPerMeeting === "—" ? "—" : `₹${costPerMeeting}`, unit: "", sub: "today's spend / meetings" },
          { label: "Pipeline Health", value: totalPipeline > 0 ? Math.round(((totalPipeline - (stats.pipeline.parked || 0)) / totalPipeline) * 100) : 0, unit: "%", sub: "active vs parked" },
        ].map((s) => (
          <div key={s.label} className="stat-card" style={{ background: "var(--warm)" }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ fontSize: 34 }}>
              {s.value}<span style={{ fontSize: 16, color: "var(--text-light)" }}>{s.unit}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 6 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Pipeline Bar */}
      <div className="glow-card" style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>Pipeline Flow</span>
          <span style={{ fontSize: 12, color: "var(--text-light)", letterSpacing: "0.04em" }}>{totalPipeline} total leads</span>
        </div>
        <div className="pipeline-bar" style={{ height: 10, borderRadius: 6 }}>
          {PIPELINE_STAGES.map((stage) => {
            const count = stats.pipeline[stage.key] || 0;
            const pct = totalPipeline > 0 ? (count / totalPipeline) * 100 : 0;
            return (
              <div
                key={stage.key}
                className="pipeline-segment"
                style={{ width: `${pct}%`, background: stage.color }}
                title={`${stage.label}: ${count}`}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
          {PIPELINE_STAGES.map((stage) => (
            <div key={stage.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: stage.color }} />
              <span style={{ color: "var(--text-dim)", letterSpacing: "0.04em" }}>{stage.label}</span>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>{stats.pipeline[stage.key] || 0}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 16, fontWeight: 500 }}>Funnel View</div>
          <FunnelChart stages={PIPELINE_STAGES.map((s) => ({ label: s.label, value: stats.pipeline[s.key] || 0, color: s.color }))} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Band Distribution */}
        <div className="glow-card">
          <h3 style={{ fontSize: 13, fontWeight: 500, marginBottom: 24, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>Score Bands</h3>
          <div style={{ display: "flex", gap: 24, alignItems: "center", marginBottom: 20 }}>
            <PieChart data={Object.entries(stats.bands).map(([k, v]) => ({ label: k, value: v as number }))} colors={BAND_COLORS} />
            <div style={{ flex: 1 }}>
              {Object.entries(BAND_COLORS).map(([band, color]) => {
                const count = stats.bands[band] || 0;
                return (
                  <div key={band} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
                    <span style={{ textTransform: "capitalize", letterSpacing: "0.04em", fontWeight: 500, flex: 1 }}>{band}</span>
                    <span style={{ color: "var(--text-dim)" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {Object.entries(BAND_COLORS).map(([band, color]) => {
            const count = stats.bands[band] || 0;
            const pct = totalBands > 0 ? (count / totalBands) * 100 : 0;
            return (
              <div key={band} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ textTransform: "capitalize", letterSpacing: "0.04em" }}>{band}</span>
                  <span style={{ color: "var(--text-dim)" }}>{Math.round(pct)}%</span>
                </div>
                <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent Calls */}
        <div className="glow-card">
          <h3 style={{ fontSize: 13, fontWeight: 500, marginBottom: 24, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>Recent Calls</h3>
          {stats.recentCalls.length === 0 ? (
            <p style={{ color: "var(--text-light)", fontSize: 13, letterSpacing: "0.02em" }}>No calls yet — start the pipeline to see activity</p>
          ) : (
            stats.recentCalls.map((call) => (
              <div
                key={call.id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "16px 0", borderBottom: "1px solid var(--border)",
                }}
              >
                <div>
                  <span className={`badge badge-${call.outcome === "booked" ? "booked" : call.outcome === "not_interested" ? "parked" : "warm"}`}>
                    {call.outcome}
                  </span>
                  {call.summary && (
                    <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "0.02em" }}>
                      {call.summary}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                    {call.durationSec ? `${Math.round(call.durationSec / 60)}m` : "—"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.04em" }}>
                    {call.sentiment && (
                      <span style={{ color: call.sentiment === "positive" ? "var(--green)" : call.sentiment === "negative" ? "var(--terracotta)" : "var(--text-light)" }}>
                        {call.sentiment}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Cost Summary */}
      <div className="glow-card" style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 13, fontWeight: 500, marginBottom: 24, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>Today&apos;s Spend</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Lead Sourcing</div>
            <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: "0.02em" }}>₹{(stats.today.costApollo / 100).toFixed(2)}</div>
            <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 4 }}>lead sourcing</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Cold Calling</div>
            <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: "0.02em" }}>₹{(stats.today.costVobiz / 100).toFixed(2)}</div>
            <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 4 }}>voice calls</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 6 }}>Total</div>
            <div style={{ fontSize: 26, fontWeight: 300, letterSpacing: "0.02em", color: "var(--accent)" }}>
              ₹{((stats.today.costApollo + stats.today.costVobiz) / 100).toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 4 }}>blended total</div>
          </div>
        </div>
      </div>
    </div>
  );
}
