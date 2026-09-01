"use client";

import { FormEvent, useState } from "react";

interface OnboardingResult {
  business: { companyName: string; industry: string; description: string; location: string };
  icp: { personTitles: string[]; employeeRanges: string[]; locations: string[] };
  leadsImported: number;
  warning?: string | null;
}

export default function BusinessOnboardingModal({ onComplete, onDismiss }: { onComplete: () => Promise<void>; onDismiss: () => void }) {
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [mapLocation, setMapLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardingResult | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, website, mapLocation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "We could not research this business");
      setResult(data);
      await onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Setup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "12px 14px", borderRadius: 10, fontSize: 14,
    background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", outline: "none",
  } as const;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(24, 27, 25, 0.58)", backdropFilter: "blur(8px)" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="business-setup-title" style={{ width: "100%", maxWidth: 620, maxHeight: "90vh", overflow: "auto", borderRadius: 22, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 28px 90px rgba(0,0,0,.28)" }}>
        <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
            <div>
              <div style={{ color: "var(--accent)", fontSize: 11, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", marginBottom: 8 }}>Personalize AarambhAI</div>
              <h2 id="business-setup-title" style={{ margin: 0, fontSize: 24, fontWeight: 500, color: "var(--text)" }}>{result ? "Your lead engine is ready" : "Tell us about your business"}</h2>
              <p style={{ margin: "8px 0 0", color: "var(--text-dim)", fontSize: 13, lineHeight: 1.6 }}>{result ? "We researched your company, built an ICP, and searched Apollo for matching decision-makers." : "We’ll research your company, generate an ideal customer profile, and find matching leads from Apollo."}</p>
            </div>
            {!loading && !result && <button type="button" onClick={onDismiss} aria-label="Close setup" style={{ width: 34, height: 34, flex: "0 0 auto", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-dim)", cursor: "pointer" }}>×</button>}
          </div>
        </div>

        {result ? (
          <div style={{ padding: 28 }}>
            <div style={{ padding: 18, borderRadius: 14, background: "var(--accent-soft)", border: "1px solid var(--accent)", marginBottom: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>{result.business.companyName}</div>
              <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 4 }}>{result.business.industry} · {result.business.location}</div>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-dim)", margin: "10px 0 0" }}>{result.business.description}</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
              <div style={{ padding: 16, borderRadius: 12, background: "var(--surface-2)" }}>
                <div style={{ fontSize: 26, fontWeight: 400, color: "var(--text)" }}>{result.leadsImported}</div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: ".1em" }}>Target leads added</div>
              </div>
              <div style={{ padding: 16, borderRadius: 12, background: "var(--surface-2)" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Ideal buyers</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>{result.icp.personTitles.slice(0, 3).join(" · ")}</div>
              </div>
            </div>
            {result.warning && <div style={{ fontSize: 12, lineHeight: 1.5, color: "#8a641f", background: "rgba(212,184,122,.18)", padding: "10px 12px", borderRadius: 9, marginBottom: 18 }}>Company research finished, but lead import needs attention: {result.warning}</div>}
            <button onClick={() => { window.location.href = "/leads"; }} style={{ width: "100%", padding: "12px 18px", border: 0, borderRadius: 10, background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>View target leads →</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 18 }}>
              <label style={{ display: "block" }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 7 }}>Business name</span>
                <input required minLength={2} value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="e.g. AarambhAI" autoFocus style={inputStyle} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 7 }}>Website URL</span>
                <input required value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://yourcompany.com" inputMode="url" style={inputStyle} />
              </label>
              <label style={{ display: "block" }}>
                <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 7 }}>Google Maps location</span>
                <input required value={mapLocation} onChange={(event) => setMapLocation(event.target.value)} placeholder="Bengaluru, Karnataka or paste a Google Maps link" style={inputStyle} />
                <span style={{ display: "block", fontSize: 11, color: "var(--text-light)", marginTop: 6 }}>Used to target companies in the markets you serve.</span>
              </label>
              {loading && <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12 }}>Researching website and company → Building ICP → Finding Apollo prospects…</div>}
              {error && <div role="alert" style={{ padding: "10px 12px", borderRadius: 9, background: "var(--terracotta-soft)", color: "var(--terracotta)", fontSize: 12, lineHeight: 1.5 }}>{error}</div>}
            </div>
            <div style={{ padding: "18px 28px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <button type="button" onClick={onDismiss} disabled={loading} style={{ border: 0, background: "transparent", color: "var(--text-dim)", fontSize: 12, cursor: loading ? "default" : "pointer" }}>Set up later</button>
              <button type="submit" disabled={loading} style={{ padding: "11px 22px", border: 0, borderRadius: 10, background: "var(--accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: loading ? "wait" : "pointer", opacity: loading ? .65 : 1 }}>{loading ? "Building your ICP…" : "Proceed →"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
