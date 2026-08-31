"use client";

import { useEffect, useState, useMemo } from "react";

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

function groupByDate<T>(items: T[], dateKey: keyof T, valueFn: (item: T) => number): { date: string; value: number }[] {
  const map: Record<string, number> = {};
  for (const item of items) {
    const date = String(item[dateKey]).split("T")[0];
    map[date] = (map[date] || 0) + valueFn(item);
  }
  return Object.entries(map)
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function groupByDateAndCategory<T>(items: T[], dateKey: keyof T, catKey: keyof T): { date: string; categories: Record<string, number> }[] {
  const map: Record<string, Record<string, number>> = {};
  for (const item of items) {
    const date = String(item[dateKey]).split("T")[0];
    const cat = String(item[catKey] || "unknown");
    if (!map[date]) map[date] = {};
    map[date][cat] = (map[date][cat] || 0) + 1;
  }
  return Object.entries(map)
    .map(([date, categories]) => ({ date, categories }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function LineChart({
  data,
  color = "var(--accent)",
  height = 120,
  fill = true,
  strokeWidth = 2,
  showPoints = false,
}: {
  data: { date: string; value: number }[];
  color?: string;
  height?: number;
  fill?: boolean;
  strokeWidth?: number;
  showPoints?: boolean;
}) {
  if (!data.length) return <div style={{ height, background: "var(--surface-2)", borderRadius: 8 }} />;
  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = data.length - 1 || 1;

  const points = data.map((d, i) => {
    const x = (i / w) * 100;
    const y = 100 - ((d.value - min) / range) * 80 - 10;
    return `${x}% ${y}%`;
  }).join(" ");

  const fillPoints = `0% 100%, ${points}, 100% 100%`;

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
        {fill && (
          <polygon points={fillPoints} fill={`${color}15`} stroke="none" />
        )}
        <polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth / 100} strokeLinecap="round" strokeLinejoin="round" />
        {showPoints && data.map((d, i) => (
          <circle key={i} cx={`${(i / w) * 100}%`} cy={`${100 - ((d.value - min) / range) * 80 - 10}%`} r={strokeWidth / 50} fill={color} />
        ))}
      </svg>
    </div>
  );
}

function MultiLineChart({
  series,
  height = 140,
}: {
  series: { label: string; data: { date: string; value: number }[]; color: string }[];
  height?: number;
}) {
  if (!series.length || !series[0].data.length) return <div style={{ height, background: "var(--surface-2)", borderRadius: 8 }} />;
  const allValues = series.flatMap((s) => s.data.map((d) => d.value));
  const max = Math.max(...allValues, 1);
  const min = Math.min(...allValues);
  const range = max - min || 1;
  const w = series[0].data.length - 1 || 1;

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
        {series.map((s) => {
          const points = s.data.map((d, i) => {
            const x = (i / w) * 100;
            const y = 100 - ((d.value - min) / range) * 80 - 10;
            return `${x}% ${y}%`;
          }).join(" ");
          return <polyline key={s.label} points={points} fill="none" stroke={s.color} strokeWidth={0.02} strokeLinecap="round" strokeLinejoin="round" />;
        })}
      </svg>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function StackedAreaChart({
  data,
  categories,
  colors,
  height = 140,
}: {
  data: { date: string; categories: Record<string, number> }[];
  categories: string[];
  colors: Record<string, string>;
  height?: number;
}) {
  if (!data.length) return <div style={{ height, background: "var(--surface-2)", borderRadius: 8 }} />;

  const maxTotal = Math.max(...data.map((d) => Object.values(d.categories).reduce((a, b) => a + b, 0)), 1);
  const w = data.length - 1 || 1;

  const layers = categories.map((cat) => {
    const points = data.map((d, i) => {
      const x = (i / w) * 100;
      const val = d.categories[cat] || 0;
      const y = 100 - (val / maxTotal) * 80 - 10;
      return `${x}% ${y}%`;
    });
    return <polygon key={cat} points={`0% 100%, ${points.join(" ")}, 100% 100%`} fill={`${colors[cat] || "#888"}33`} stroke={colors[cat]} strokeWidth="0.01" />;
  });

  return (
    <div style={{ position: "relative", height, width: "100%" }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
        {layers}
      </svg>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        {categories.map((c) => (
          <span key={c} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: colors[c] }} />
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function Heatmap({
  data,
  days = 7,
  hours = 24,
  cellSize = 14,
}: {
  data: Array<{ hour: number; day: number; value: number }>;
  days?: number;
  hours?: number;
  cellSize?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: cellSize + 2 }}>
        <div style={{ width: 30 }} />
        {Array.from({ length: hours }, (_, h) => (
          <div key={h} style={{ width: cellSize, textAlign: "center", fontSize: 9, color: "var(--text-light)" }}>{h}:00</div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {Array.from({ length: days }, (_, d) => (
          <div key={d} style={{ display: "flex", gap: 2, alignItems: "center" }}>
            <div style={{ width: 30, fontSize: 10, color: "var(--text-dim)", textAlign: "right", paddingRight: 8 }}>{dayLabels[d]}</div>
            {Array.from({ length: hours }, (_, h) => {
              const cell = data.find((x) => x.day === d && x.hour === h);
              const val = cell?.value || 0;
              const intensity = val / max;
              const bg = `rgba(138, 154, 139, ${0.15 + intensity * 0.7})`;
              return (
                <div
                  key={h}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    background: bg,
                    borderRadius: 3,
                    cursor: "pointer",
                  }}
                  title={`${dayLabels[d]} ${h}:00 — ${val} calls`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "var(--text-light)" }}>
        <span>Low</span>
        <div style={{ width: 60, height: 8, background: "linear-gradient(to right, rgba(138,154,139,0.15), var(--accent))", borderRadius: 4 }} />
        <span>High</span>
      </div>
    </div>
  );
}

function BarChart({
  data,
  color = "var(--accent)",
  height = 120,
  maxBars = 30,
}: {
  data: { label: string; value: number }[];
  color?: string;
  height?: number;
  maxBars?: number;
}) {
  if (!data.length) return <div style={{ height, background: "var(--surface-2)", borderRadius: 8 }} />;
  const displayData = data.slice(-maxBars);
  const max = Math.max(...displayData.map((d) => d.value), 1);

  return (
    <div style={{ height, display: "flex", alignItems: "flex-end", gap: 4, overflowX: "auto", paddingBottom: 20 }}>
      {displayData.map((d, i) => (
        <div key={d.label} style={{ flex: 1, minWidth: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div
            style={{
              width: "100%",
              height: `${(d.value / max) * (height - 30)}px`,
              background: color,
              borderRadius: "3px 3px 0 0",
              transition: "height 0.3s",
            }}
            title={`${d.label}: ${d.value}`}
          />
          <span style={{ fontSize: 9, color: "var(--text-light)", textAlign: "center", whiteSpace: "nowrap" }}>
            {d.label.length > 8 ? d.label.slice(0, 7) + "…" : d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function GaugeChart({
  value,
  max = 100,
  color = "var(--accent)",
  size = 80,
  label = "",
}: {
  value: number;
  max?: number;
  color?: string;
  size?: number;
  label?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const angle = (pct / 100) * 270 - 135;
  const r = size / 2 - 6;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={8} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeDasharray={`${(pct / 100) * 2 * Math.PI * r} ${2 * Math.PI * r}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(-135 ${size / 2} ${size / 2)}`}
          style={{ transition: "stroke-dasharray 0.5s" }}
        />
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 300, color: "var(--text)" }}>{value}{max > 100 ? "%" : ""}</div>
        {label && <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>}
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, trend, color = "var(--text)", icon }: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: { value: number; label: string };
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="stat-card" style={{ background: "var(--surface)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="stat-label">{label}</div>
        {icon && <div style={{ color: "var(--text-light)", fontSize: 20 }}>{icon}</div>}
      </div>
      <div className="stat-value" style={{ color, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 4 }}>{sub}</div>}
      {trend && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: trend.value >= 0 ? "var(--green)" : "var(--terracotta)" }}>
            {trend.value >= 0 ? "▲" : "▼"} {Math.abs(trend.value)}%
          </span>
          <span style={{ fontSize: 11, color: "var(--text-light)" }}>{trend.label}</span>
        </div>
      )}
    </div>
  );
}

export { LineChart, MultiLineChart, StackedAreaChart, Heatmap, BarChart, GaugeChart, KPICard, groupByDate, groupByDateAndCategory };