"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/leads", label: "Leads", icon: "users" },
  { href: "/activity", label: "Activity", icon: "activity" },
  { href: "/connections", label: "Connections", icon: "link" },
  { href: "/wallet-balance", label: "Wallet", icon: "wallet" },
];

const ICONS: Record<string, JSX.Element> = {
  grid: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>,
  users: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  activity: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  link: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
  wallet: <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/><circle cx="17" cy="14" r="1"/></svg>,
};

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const path = usePathname();
  const [callsToday, setCallsToday] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.today?.callsMade !== undefined) setCallsToday(d.today.callsMade);
      })
      .catch(() => {});
  }, [path]);

  return (
    <aside className="sidebar" style={{ width: collapsed ? 64 : 260, transition: "width 0.2s" }}>
      <div style={{ padding: collapsed ? "0 12px 24px" : "0 24px 32px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, overflow: "hidden" }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, flexShrink: 0,
            background: "var(--surface-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <img src="/favicon.png" alt="AarambhAI" style={{ width: 40, height: 40, objectFit: "contain" }} />
          </div>
          {!collapsed && (
            <div>
              <div style={{ fontWeight: 400, fontSize: 16, letterSpacing: "0.06em", color: "var(--text)" }}>AARAMBHAI</div>
              <div style={{ fontSize: 10, color: "var(--text-light)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Lead Engine</div>
            </div>
          )}
        </div>
        <button onClick={onToggle} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, width: 28, height: 28, cursor: "pointer", color: "var(--text-dim)", flexShrink: 0 }}>
          {collapsed ? "→" : "←"}
        </button>
      </div>

      <nav style={{ marginTop: 32 }}>
        {NAV.map((item) => {
          const active = path === item.href || path.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${active ? "active" : ""}`}
              style={collapsed ? { justifyContent: "center", padding: "12px 0" } : undefined}
              title={collapsed ? item.label : undefined}
            >
              {ICONS[item.icon]}
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ position: "absolute", bottom: 28, left: 0, right: 0, padding: collapsed ? "0 12px" : "0 24px" }}>
        {collapsed ? (
          <div style={{ display: "flex", justifyContent: "center" }}><div className="pulse-dot" /></div>
        ) : (
          <div style={{
            background: "var(--warm)", borderRadius: 12, padding: 16,
            border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div className="pulse-dot" />
              <span style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>System Online</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.02em" }}>
              Pipeline active — {callsToday === null ? "…" : `${callsToday} calls today`}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
