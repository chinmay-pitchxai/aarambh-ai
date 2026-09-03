"use client";

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import ThemeToggle from "./ThemeToggle";
import NotificationBell from "./NotificationBell/NotificationBell";
import BusinessOnboardingModal from "./BusinessOnboardingModal";
import { useAuth } from "./AuthProvider";

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, org, loading, refreshSession } = useAuth();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  const leftW = leftCollapsed ? 64 : 260;

  useEffect(() => {
    if (!loading && !user) {
      const from = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`/auth/login?from=${encodeURIComponent(from)}`);
    }
  }, [loading, user]);

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
      {!loading && org && !org.onboardingCompleted && !onboardingDismissed && (
        <BusinessOnboardingModal onComplete={refreshSession} onDismiss={() => setOnboardingDismissed(true)} />
      )}
      <div style={{ marginLeft: leftW, minHeight: "100vh", padding: "48px 48px", position: "relative", transition: "margin 0.2s" }}>
        <div style={{ position: "absolute", top: 24, right: 32, zIndex: 10, display: "flex", gap: 12, alignItems: "center" }}>
          <NotificationBell />
          <ThemeToggle />
        </div>
        <main>{children}</main>
      </div>
    </>
  );
}
