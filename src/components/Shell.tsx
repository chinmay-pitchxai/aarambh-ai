"use client";

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import RightSidebar from "./RightSidebar";
import ThemeToggle from "./ThemeToggle";
import BusinessOnboardingModal from "./BusinessOnboardingModal";
import { useAuth } from "./AuthProvider";

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, org, loading, refreshSession } = useAuth();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const leftW = leftCollapsed ? 64 : 260;
  const rightW = rightOpen ? 360 : 0;

  useEffect(() => {
    if (!loading && !user) {
      const from = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/auth/login?from=${encodeURIComponent(from)}`);
    }
  }, [loading, user]);

  // The middleware can only see the opaque cookie. Wait for the server-backed
  // session check before mounting any protected UI, so stale cookies cannot
  // expose a broken dashboard or bounce users past the login page.
  if (loading || !user) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "var(--text-light)", fontSize: 13, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Checking your session…
      </div>
    );
  }

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
