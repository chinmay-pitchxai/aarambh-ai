"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <h2 style={{ color: "var(--terracotta)", fontWeight: 300, letterSpacing: "0.04em" }}>Something went wrong</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 12 }}>{error.message}</p>
      <button onClick={reset} className="btn-primary" style={{ marginTop: 20 }}>
        Try again
      </button>
    </div>
  );
}
