"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      router.push(from);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      width: "100%",
      maxWidth: 420,
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: "40px 32px 32px",
    }}>
      {/* Logo */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 24,
          fontWeight: 500,
          color: "var(--text)",
          letterSpacing: "0.02em",
        }}>
          Aarambh<span style={{ color: "var(--accent)" }}>AI</span>
        </div>
      </div>

      {/* Tab Toggle */}
      <div style={{
        display: "flex",
        background: "var(--surface-2)",
        borderRadius: 10,
        padding: 4,
        marginBottom: 28,
      }}>
        <div style={{
          flex: 1,
          textAlign: "center",
          padding: "10px 0",
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 8,
          background: "var(--surface)",
          color: "var(--text)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          letterSpacing: "0.02em",
        }}>
          Sign In
        </div>
        <Link href="/auth/signup" style={{
          flex: 1,
          textAlign: "center",
          padding: "10px 0",
          fontSize: 13,
          fontWeight: 500,
          borderRadius: 8,
          color: "var(--text-dim)",
          textDecoration: "none",
          letterSpacing: "0.02em",
          transition: "color 0.15s",
        }}>
          Create Account
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: "var(--terracotta-soft)",
          color: "var(--terracotta)",
          padding: "10px 14px",
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 20,
          border: "1px solid var(--border)",
        }}>
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: "block",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-dim)",
            marginBottom: 6,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: 14,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
              outline: "none",
              transition: "border-color 0.15s",
              letterSpacing: "0.01em",
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = "var(--accent)"}
            onBlur={(e) => e.currentTarget.style.borderColor = "var(--border)"}
            placeholder="you@company.com"
          />
        </div>

        <div style={{ marginBottom: 24 }}>
          <label style={{
            display: "block",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--text-dim)",
            marginBottom: 6,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{
              width: "100%",
              padding: "12px 14px",
              fontSize: 14,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text)",
              outline: "none",
              transition: "border-color 0.15s",
              letterSpacing: "0.01em",
            }}
            onFocus={(e) => e.currentTarget.style.borderColor = "var(--accent)"}
            onBlur={(e) => e.currentTarget.style.borderColor = "var(--border)"}
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 0",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "0.04em",
            background: loading ? "var(--accent-hover)" : "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: loading ? "not-allowed" : "pointer",
            transition: "background 0.15s, transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={(e) => {
            if (!loading) {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>
      </form>

      {/* Divider */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        margin: "24px 0",
      }}>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        <span style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          or
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
      </div>

      {/* Google Button */}
      <a
        href="/api/auth/google"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          width: "100%",
          padding: "11px 0",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--text)",
          background: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 8,
          cursor: "pointer",
          textDecoration: "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--text-light)";
          e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </a>

      {/* Footer Link */}
      <div style={{ textAlign: "center", marginTop: 24, fontSize: 13, color: "var(--text-dim)" }}>
        Don&apos;t have an account?{" "}
        <Link href="/auth/signup" style={{
          color: "var(--accent)",
          textDecoration: "none",
          fontWeight: 500,
          transition: "color 0.15s",
        }}>
          Sign up
        </Link>
      </div>
      <div style={{ textAlign: "center", marginTop: 12, fontSize: 12 }}>
        <button
          onClick={() => { document.cookie = "session=; path=/; max-age=0"; window.location.reload(); }}
          style={{ background: "none", border: "none", color: "var(--text-light)", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
        >
          Clear session &amp; retry
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
