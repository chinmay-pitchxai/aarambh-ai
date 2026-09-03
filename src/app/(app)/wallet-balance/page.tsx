"use client";

import { useEffect, useState, useCallback } from "react";

interface Stats {
  today: {
    costApollo: number;
    costVobiz: number;
  };
}

export default function WalletBalancePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalCost = stats ? stats.today.costApollo + stats.today.costVobiz : 0;

  const handleAddFunds = useCallback(() => {
    window.location.href = "/connections";
  }, []);

  return (
    <div>
      <div className="section-header">
        <h1>Wallet Balance</h1>
        <p>Manage funds for lead sourcing and cold calling</p>
      </div>

      {/* Main balance card */}
      <div className="glow-card" style={{ marginBottom: 32, background: "linear-gradient(135deg, var(--surface) 0%, var(--warm) 100%)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 600, marginBottom: 8 }}>Available Balance</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span style={{ fontSize: 48, fontWeight: 300, letterSpacing: "0.02em", color: "var(--text)" }}>₹12,450<span style={{ fontSize: 28, color: "var(--text-light)" }}>.00</span></span>
              <span style={{ fontSize: 12, color: "var(--green)", background: "rgba(122,154,126,0.12)", padding: "4px 10px", borderRadius: 20, border: "1px solid rgba(122,154,126,0.2)", alignSelf: "center" }}>● Active</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-light)", marginTop: 8, letterSpacing: "0.02em" }}>Available for lead sourcing + cold calling — auto-recharges at ₹2,000</div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button className="btn-secondary" style={{ padding: "10px 18px", fontSize: 12 }}>History</button>
            <button className="btn-primary" onClick={handleAddFunds} style={{ padding: "10px 20px", fontSize: 12 }}>+ Add Funds</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.04em" }}>Spent today</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--terracotta)" }}>-₹{(totalCost / 100).toFixed(2)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.04em" }}>Last top-up</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--green)" }}>+₹5,000</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", borderRadius: 10, padding: "12px 14px", border: "1px solid var(--border)" }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.04em" }}>Low balance at</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>₹2,000</span>
          </div>
        </div>
      </div>

      {/* Spend breakdown */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 32 }}>
        <div className="glow-card">
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 600, marginBottom: 16 }}>Lead Sourcing</div>
          <div style={{ fontSize: 32, fontWeight: 300, letterSpacing: "0.02em", marginBottom: 8 }}>₹{stats ? (stats.today.costApollo / 100).toFixed(2) : "0.00"}</div>
          <div style={{ fontSize: 12, color: "var(--text-light)", marginBottom: 20 }}>spent today</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-dim)" }}>Cost per lead</span>
            <span style={{ fontWeight: 600 }}>{stats && stats.today.costApollo > 0 ? "₹" + (stats.today.costApollo / 100).toFixed(2) : "—"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-dim)" }}>Rate</span>
            <span style={{ fontWeight: 600 }}>/bin/zsh.03 / contact</span>
          </div>
        </div>

        <div className="glow-card">
          <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 600, marginBottom: 16 }}>Cold Calling</div>
          <div style={{ fontSize: 32, fontWeight: 300, letterSpacing: "0.02em", marginBottom: 8 }}>₹{stats ? (stats.today.costVobiz / 100).toFixed(2) : "0.00"}</div>
          <div style={{ fontSize: 12, color: "var(--text-light)", marginBottom: 20 }}>spent today</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-dim)" }}>Cost per minute</span>
            <span style={{ fontWeight: 600 }}>/bin/zsh.012</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--text-dim)" }}>Rate</span>
            <span style={{ fontWeight: 600 }}>/bin/zsh.012 / min</span>
          </div>
        </div>
      </div>

      {/* Transaction history placeholder */}
      <div className="glow-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>Recent Transactions</h3>
          <span style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.04em" }}>Last 30 days</span>
        </div>
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-light)", fontSize: 13, letterSpacing: "0.02em" }}>
          No transactions yet — start the pipeline to see usage
        </div>
      </div>
    </div>
  );
}
