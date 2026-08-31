"use client";

import Link from "next/link";
import { useState } from "react";

const PRICING = [
  {
    name: "Starter",
    tagline: "For testing the waters",
    priceMonthly: 25,
    features: [
      "100 calls/mo",
      "10 warm leads",
      "WhatsApp + Email",
      "Basic dashboard",
    ],
    cta: "Start Free Trial",
    highlight: false,
    color: "var(--accent)",
    guarantee: false,
  },
  {
    name: "Growth",
    tagline: "For serious pipeline",
    priceMonthly: 50,
    features: [
      "250 calls/mo",
      "25 warm leads",
      "5 booked meetings guaranteed",
      "AI meeting assistant",
      "Priority support",
    ],
    cta: "Get Started",
    highlight: true,
    color: "var(--terracotta)",
    guarantee: true,
  },
  {
    name: "Scale",
    tagline: "For aggressive growth",
    priceMonthly: 75,
    features: [
      "500 calls/mo",
      "50 warm leads",
      "10 booked meetings guaranteed",
      "AI meeting assistant",
      "Dedicated manager",
    ],
    cta: "Contact Sales",
    highlight: false,
    color: "var(--amber)",
    guarantee: true,
  },
];

const FAQS = [
  { q: "How quickly can I go live?", a: "Most teams are live within 2 hours. Tell us who you sell to, and the pipeline starts sourcing and qualifying leads immediately." },
  { q: "Do I need to provide my own phone numbers?", a: "No. We handle outbound calling with local numbers. You only need a WhatsApp Business API connection." },
  { q: "What happens to leads that don't answer?", a: "They enter a 24-hour smart retry queue. After retries, unanswered leads move to WhatsApp + email nurture sequences automatically. Nothing drops." },
  { q: "Is my data secure?", a: "Yes. All data is encrypted at rest, we're GDPR compliant, and DNC lists are checked before every call. Your data stays yours." },
  { q: "What does 'zero leakage' mean?", a: "Every lead is tracked in a temporal knowledge graph. No lead is ever dropped, forgotten, or called twice. We follow up at Day 1, 2, 5, 14, 30, 60, 90 — until they say not interested." },
  { q: "What's the money-back guarantee?", a: "If we don't deliver the promised number of warm leads or booked meetings in your first month, we refund you. No questions asked." },
];

const BILLING_OPTIONS = [
  { label: "Monthly", discount: 0 },
  { label: "Quarterly", discount: 0.10 },
  { label: "Yearly", discount: 0.20 },
];

export default function PricingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [billingIdx, setBillingIdx] = useState(0);

  return (
    <div>
      {/* Hero */}
      <section style={{ padding: "80px 0 56px", background: "var(--bg)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
          <div className="animate-fade-in-up" style={{
            display: "inline-block", padding: "6px 16px", borderRadius: 20,
            background: "var(--accent-soft)", color: "var(--accent)",
            fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            marginBottom: 24,
          }}>
            Pricing
          </div>
          <h1 className="animate-fade-in-up delay-1" style={{ fontSize: 48, fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1, color: "var(--text)", marginBottom: 16 }}>
            Simple, Predictable Pricing
          </h1>
          <p className="animate-fade-in-up delay-2" style={{ fontSize: 18, color: "var(--text-dim)", maxWidth: 520, margin: "0 auto", lineHeight: 1.7 }}>
            No auctions. No hidden fees. Pay for outcomes — not clicks. 14-day free trial, no credit card.
          </p>

          {/* Billing toggle */}
          <div className="animate-fade-in-up delay-3" style={{
            display: "inline-flex", gap: 0, marginTop: 32,
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
            padding: 3,
          }}>
            {BILLING_OPTIONS.map((opt, i) => {
              const active = billingIdx === i;
              return (
                <button
                  key={opt.label}
                  onClick={() => setBillingIdx(i)}
                  style={{
                    padding: "8px 20px", border: "none", borderRadius: 8,
                    background: active ? "var(--accent)" : "transparent",
                    color: active ? "#fff" : "var(--text-dim)",
                    fontSize: 13, fontWeight: 500, cursor: "pointer",
                    transition: "all 0.2s ease",
                    fontFamily: "Playfair Display, serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  {opt.label}
                  {opt.discount > 0 && (
                    <span style={{
                      marginLeft: 6, fontSize: 11, fontWeight: 600,
                      color: active ? "rgba(255,255,255,0.9)" : "var(--green)",
                    }}>-{opt.discount * 100}%</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing cards */}
      <section style={{ paddingBottom: "80px", background: "var(--bg)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, alignItems: "start" }}>
            {PRICING.map((p, i) => (
              <div
                key={p.name}
                className={`lp-card animate-fade-in-up delay-${i + 1}`}
                style={{
                  background: "var(--surface)",
                  border: p.highlight ? "2px solid var(--accent)" : "1px solid var(--border)",
                  borderRadius: 16, padding: 32,
                }}
              >
                {p.highlight && (
                  <div style={{
                    background: "var(--accent-soft)", color: "var(--accent)",
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                    marginBottom: 16, display: "inline-block",
                    padding: "4px 12px", borderRadius: 6,
                    fontFamily: "Playfair Display, serif",
                  }}>Most Popular</div>
                )}

                {/* Color accent line */}
                <div style={{ width: 32, height: 3, borderRadius: 2, background: p.color, marginBottom: 20 }} />

                <h3 style={{
                  fontSize: 20, fontWeight: 500, marginBottom: 4, color: "var(--text)",
                  fontFamily: "Playfair Display, serif",
                }}>{p.name}</h3>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 20 }}>{p.tagline}</div>

                <div style={{ marginBottom: 24 }}>
                  {(() => {
                    const base = p.priceMonthly;
                    const disc = BILLING_OPTIONS[billingIdx].discount;
                    const effective = base * (1 - disc);
                    const display = effective % 1 === 0 ? `${effective}` : `${effective.toFixed(1)}`;
                    return (
                      <>
                        <span style={{ fontSize: 40, fontWeight: 400, color: "var(--text)", fontFamily: "Playfair Display, serif" }}>₹{display}K</span>
                        <span style={{ fontSize: 14, color: "var(--text-light)" }}>/mo</span>
                        {disc > 0 && (
                          <div style={{ fontSize: 12, color: "var(--text-light)", marginTop: 4, textDecoration: "line-through" }}>
                            ₹{base}K/mo
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                <div style={{ width: "100%", height: 1, background: "var(--border)", marginBottom: 24 }} />

                <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: 28 }}>
                  {p.features.map((f) => (
                    <li key={f} style={{
                      fontSize: 14, color: "var(--text-dim)", lineHeight: 2.4,
                      display: "flex", alignItems: "center", gap: 10,
                    }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 5,
                        background: "var(--accent-soft)", color: "var(--accent)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      {f}
                    </li>
                  ))}
                  {p.guarantee && (
                    <li style={{
                      fontSize: 14, color: "var(--green)", lineHeight: 2.4,
                      display: "flex", alignItems: "center", gap: 10,
                    }}>
                      <span style={{ fontSize: 15 }}>🛡️</span>
                      Money-back guarantee
                    </li>
                  )}
                </ul>

                <Link
                  href="/dashboard"
                  className="btn-lift"
                  style={{
                    display: "block", textAlign: "center", textDecoration: "none",
                    padding: "14px 20px", fontSize: 14, fontWeight: 500, borderRadius: 10,
                    background: p.highlight ? "var(--accent)" : "var(--surface)",
                    color: p.highlight ? "#fff" : "var(--text)",
                    border: p.highlight ? "none" : "1px solid var(--border)",
                    fontFamily: "Playfair Display, serif",
                    transition: "all 0.2s ease",
                  }}
                >
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section style={{ padding: "80px 0", background: "var(--surface)" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>FAQ</div>
            <h1 style={{ fontSize: 36, fontWeight: 400, color: "var(--text)", fontFamily: "Playfair Display, serif" }}>Common Questions</h1>
          </div>

          <div>
            {FAQS.map((faq, i) => (
              <div
                key={i}
                style={{
                  borderBottom: "1px solid var(--border)",
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{
                    width: "100%", padding: "20px 0", border: "none", background: "none",
                    cursor: "pointer", textAlign: "left",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    gap: 16,
                  }}
                >
                  <span style={{
                    fontSize: 15, fontWeight: 500, color: openFaq === i ? "var(--accent)" : "var(--text)",
                    transition: "color 0.2s",
                    fontFamily: "Playfair Display, serif",
                  }}>{faq.q}</span>
                  <span style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: openFaq === i ? "var(--accent-soft)" : "var(--surface-2)",
                    color: openFaq === i ? "var(--accent)" : "var(--text-dim)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    transition: "all 0.25s ease",
                    transform: openFaq === i ? "rotate(45deg)" : "rotate(0deg)",
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  </span>
                </button>
                <div
                  className={`faq-answer ${openFaq === i ? "open" : ""}`}
                  style={{ paddingBottom: openFaq === i ? 20 : 0 }}
                >
                  <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7 }}>{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding: "72px 0",
        background: "linear-gradient(135deg, var(--terracotta) 0%, var(--amber) 100%)",
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
          <h2 style={{ fontSize: 36, fontWeight: 400, color: "#fff", marginBottom: 16, fontFamily: "Playfair Display, serif" }}>
            Start Your Free Trial Today
          </h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.9)", marginBottom: 32, lineHeight: 1.6 }}>
            14 days free. No credit card. Tell us what you sell — we&apos;ll show you the leads.
          </p>
          <Link href="/dashboard" className="btn-lift" style={{
            background: "#fff", color: "var(--terracotta)", textDecoration: "none",
            padding: "14px 32px", fontSize: 14, borderRadius: 10, fontWeight: 600,
            display: "inline-block",
            fontFamily: "Playfair Display, serif",
          }}>
            Get Started Free →
          </Link>
        </div>
      </section>
    </div>
  );
}
