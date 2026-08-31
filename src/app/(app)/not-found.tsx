import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <h2 style={{ color: "var(--text)", fontWeight: 300, letterSpacing: "0.04em", fontSize: 28 }}>404</h2>
      <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 8 }}>Page not found</p>
      <Link href="/dashboard" className="btn-primary" style={{ display: "inline-block", marginTop: 20, textDecoration: "none" }}>
        Back to Dashboard
      </Link>
    </div>
  );
}
