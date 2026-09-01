"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import RightSidebar from "./RightSidebar";
import ThemeToggle from "./ThemeToggle";
import BusinessOnboardingModal from "./BusinessOnboardingModal";
import { useAuth } from "./AuthProvider";

export default function Shell({ children }: { children: React.ReactNode }) {
  const { org, loading, refreshSession } = useAuth();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const leftW = leftCollapsed ? 64 : 260;
  const rightW = rightOpen ? 360 : 0;

  return (
    <>
      <Sidebar collapsed={leftCollapsed} onToggle={() => setLeftCollapsed((v) => !v)} />
      <RightSidebar open={rightOpen} onClose={() => setRightOpen(false)} />
      {!loading && org && !org.onboardingCompleted && !onboardingDismissed && (
        <BusinessOnboardingModal onComplete={refreshSession} onDismiss={() => setOnboardingDismissed(true)} />
      )}
      <div style={{ marginLeft: leftW, marginRight: rightW, minHeight: "100vh", padding: "48px 48px", position: "relative", transition: "margin 0.2s" }}>
        <div style={{ position: "absolute", top: 24, right: 32, zIndex: 10, display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={() => setRightOpen((v) => !v)}
            style={{
              background: rightOpen ? "var(--accent)" : "var(--surface)", color: rightOpen ? "#fff" : "var(--text-dim)",
              border: `1px solid ${rightOpen ? "var(--accent)" : "var(--border)"}`, borderRadius: 20, padding: "8px 16px",
              fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500, cursor: "pointer",
            }}
          >
            {rightOpen ? "Close Agent" : "Agent"}
          </button>
          <ThemeToggle />
        </div>
        <main>{children}</main>
      </div>
    </>
  );
}
