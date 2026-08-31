import Link from "next/link";

const STATS = [
  { value: "50%", label: "Contact Rate" },
  { value: "₹99", label: "Cost Per Meeting" },
  { value: "0", label: "Leads Leaked" },
  { value: "<5 min", label: "First Call Speed" },
];

const STEPS = [
  { num: "01", title: "Tell Us What You Sell", desc: "Share your business, your ideal customer, your pitch. We build your pipeline in minutes — not weeks.", color: "var(--accent)" },
  { num: "02", title: "We Find Your Buyers", desc: "AI scans thousands of prospects, scores them on fit, and builds a targeted list. Zero guesswork.", color: "var(--terracotta)" },
  { num: "03", title: "We Call Every One", desc: "Every lead gets a call in under 5 minutes. While your competitor is still reading the form, we've already qualified them.", color: "var(--amber)" },
  { num: "04", title: "Leads Come to You", desc: "Warm, qualified, ready to meet. WhatsApp follow-up keeps the ones who didn't pick up. Nothing drops. Ever.", color: "var(--green)" },
];

const TESTIMONIALS = [
  { name: "Rahul Sharma", role: "VP Sales, Acme Corp", quote: "We were spending ₹2L/mo on Meta Ads with unpredictable results. AarambhAI delivers 50+ qualified meetings at half the cost.", initials: "RS" },
  { name: "Priya Patel", role: "Head of Growth, TechVista", quote: "Our team couldn't call 500 leads/day. AarambhAI does it automatically, and the AI sounds more human than our SDRs.", initials: "PP" },
  { name: "Amit Kumar", role: "CEO, DataFlow", quote: "The dashboard shows exactly where every lead is. No more 'I think someone called them' excuses. Complete transparency.", initials: "AK" },
];

const DASH_PIPELINE = [
  { stage: "New", value: 240, color: "var(--accent)" },
  { stage: "Contacted", value: 180, color: "var(--amber)" },
  { stage: "Qualified", value: 120, color: "var(--terracotta)" },
  { stage: "Booked", value: 84, color: "var(--green)" },
];

export default function LandingPage() {
  return (
    <div>
      {/* ── HERO ── */}
      <section style={{ padding: "80px 0", background: "var(--bg)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center" }}>
          {/* Left — copy */}
          <div>
            <div style={{
              display: "inline-block", padding: "6px 16px", borderRadius: 20,
              background: "var(--accent-soft)", color: "var(--accent)",
              fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
              marginBottom: 24,
            }}>
              Zero-Leakage AI GTM
            </div>
            <h1 style={{ fontSize: 48, fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1, color: "var(--text)", marginBottom: 20 }}>
              Your Pipeline,<br />Run by AI.
            </h1>
            <p style={{ fontSize: 17, color: "var(--text-dim)", lineHeight: 1.7, marginBottom: 32 }}>
              Tell us what you sell. We find the right buyers, call every one of them in under 5 minutes, qualify them on the phone, follow up on WhatsApp — and hand your sales team only the people worth meeting.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link
                href="/dashboard"
                style={{
                  background: "var(--accent)", color: "#fff", textDecoration: "none",
                  padding: "14px 32px", fontSize: 14, borderRadius: 10, fontWeight: 500,
                  letterSpacing: "0.02em", display: "inline-block",
                }}
              >
                Start Free Trial
              </Link>
              <Link
                href="/landing-page/features"
                style={{
                  background: "var(--surface)", color: "var(--text)", textDecoration: "none",
                  padding: "14px 32px", fontSize: 14, borderRadius: 10, fontWeight: 500,
                  border: "1px solid var(--border)", display: "inline-block",
                }}
              >
                See How It Works →
              </Link>
            </div>
          </div>

          {/* Right — dashboard preview */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16,
            padding: 28, textAlign: "left",
            boxShadow: "0 8px 40px rgba(0,0,0,0.06)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)" }} />
                <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.04em", color: "var(--text)" }}>Pipeline Dashboard</span>
                <span style={{ fontSize: 11, color: "var(--text-light)", marginLeft: 8 }}>Live</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-light)" }}>Today</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Total Leads", value: "1,247", sub: "+12% this week", accent: "var(--text)" },
                { label: "Contact Rate", value: "52%", sub: "+3% vs target", accent: "var(--accent)" },
                { label: "Warm Leads", value: "89", sub: "+8 today", accent: "var(--green)" },
                { label: "Leaked", value: "0", sub: "zero leakage", accent: "var(--terracotta)" },
              ].map((m) => (
                <div key={m.label} style={{
                  background: "var(--warm)", borderRadius: 10, padding: 16,
                  border: "1px solid var(--border)",
                }}>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{m.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 300, color: m.accent, marginBottom: 2 }}>{m.value}</div>
                  <div style={{ fontSize: 11, color: "var(--text-light)" }}>{m.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>Pipeline Flow</span>
                <span style={{ fontSize: 11, color: "var(--text-light)" }}>624 total</span>
              </div>
              <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", background: "var(--surface-2)", gap: 2 }}>
                {DASH_PIPELINE.map((s) => (
                  <div key={s.stage} style={{ width: `${(s.value / 240) * 100}%`, background: s.color, borderRadius: 2 }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                {DASH_PIPELINE.map((s) => (
                  <div key={s.stage} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: 2, background: s.color }} />
                    <span style={{ color: "var(--text-dim)" }}>{s.stage}</span>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <div style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Recent Activity</div>
              {[
                { name: "Rahul Sharma, Acme Corp", action: "Meeting booked", time: "2m ago", badge: "hot", score: 92 },
                { name: "Priya Patel, TechVista", action: "Called — interested", time: "8m ago", badge: "warm", score: 88 },
                { name: "Amit Kumar, DataFlow", action: "WhatsApp follow-up", time: "15m ago", badge: "warm", score: 85 },
              ].map((a) => (
                <div key={a.name} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 0", borderBottom: "1px solid var(--border)",
                }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{a.name}</span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{a.action}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)" }}>{a.score}</span>
                    <span className={`badge badge-${a.badge}`} style={{ fontSize: 9 }}>{a.badge}</span>
                    <span style={{ fontSize: 10, color: "var(--text-light)" }}>{a.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TRUST BAR ── */}
      <section style={{ padding: "48px 0", background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 20 }}>
            Trusted by revenue teams across industries
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 48, alignItems: "center", opacity: 0.4 }}>
            {["Real Estate", "EdTech", "SaaS", "FinTech", "Healthcare"].map((name) => (
              <span key={name} style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", letterSpacing: "0.04em" }}>{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY WE EXIST ── */}
      <section style={{ padding: "80px 0", background: "var(--bg)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Why AarambhAI Exists</div>
            <h1 style={{ fontSize: 36, fontWeight: 400, color: "var(--text)", marginBottom: 12 }}>The #1 Reason Deals Die<br />Isn&apos;t Price. It&apos;s Speed.</h1>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 32 }}>
              <div style={{ fontSize: 32, fontWeight: 300, color: "var(--accent)", marginBottom: 12 }}>5 min</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Speed to First Call</h3>
              <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7 }}>78% of buyers choose the first responder. Most companies take 6+ hours. We call in under 5 minutes — while the lead is still interested.</p>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 32 }}>
              <div style={{ fontSize: 32, fontWeight: 300, color: "var(--terracotta)", marginBottom: 12 }}>0</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Zero Leakage</h3>
              <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7 }}>Every lead is tracked. No lead is ever dropped, forgotten, or called twice. We follow up at Day 1, 2, 5, 14, 30, 60, 90 — until they say &ldquo;not interested.&rdquo;</p>
            </div>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 32 }}>
              <div style={{ fontSize: 32, fontWeight: 300, color: "var(--amber)", marginBottom: 12 }}>₹99</div>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>Predictable Cost</h3>
              <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.7 }}>Meta Ads uses an auction — costs change daily. Our price is fixed at ₹99 per booked meeting. No surprises, no algorithm changes.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section style={{ padding: "64px 0", background: "var(--surface)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {STATS.map((s) => (
              <div key={s.label} style={{
                textAlign: "center", padding: "28px 16px",
                background: "var(--bg)", borderRadius: 12, border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: 32, fontWeight: 300, color: "var(--accent)", marginBottom: 8 }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: "80px 0", background: "var(--bg)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>How It Works</div>
            <h1 style={{ fontSize: 36, fontWeight: 400, color: "var(--text)", marginBottom: 12 }}>Tell Us What You Sell.<br />We Bring You Leads.</h1>
            <p style={{ fontSize: 15, color: "var(--text-dim)", maxWidth: 500, margin: "0 auto" }}>Four steps. Fully autonomous. Your sales team only talks to warm prospects.</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {STEPS.map((s) => (
              <div key={s.num} style={{
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
                padding: 32, position: "relative", overflow: "hidden",
              }}>
                <div style={{ position: "absolute", top: -8, right: -4, fontSize: 72, fontWeight: 200, color: s.color, opacity: 0.08 }}>{s.num}</div>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, marginBottom: 16,
                  background: `${s.color}18`, color: s.color,
                  display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14,
                }}>{s.num}</div>
                <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>{s.title}</h3>
                <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>{s.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 40 }}>
            <Link
              href="/landing-page/features"
              style={{
                color: "var(--accent)", textDecoration: "none", fontSize: 13, fontWeight: 500,
                letterSpacing: "0.02em",
              }}
            >
              See all features in detail →
            </Link>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section style={{ padding: "80px 0", background: "var(--surface)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Testimonials</div>
            <h1 style={{ fontSize: 36, fontWeight: 400, color: "var(--text)" }}>What Revenue Teams Are Saying</h1>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {TESTIMONIALS.map((t) => (
              <div key={t.name} style={{
                background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14,
                padding: 28,
              }}>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-dim)", marginBottom: 24 }}>&ldquo;{t.quote}&rdquo;</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: "var(--accent-soft)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 600,
                  }}>{t.initials}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-light)" }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section style={{
        padding: "72px 0",
        background: "linear-gradient(135deg, var(--terracotta) 0%, var(--amber) 100%)",
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
          <h2 style={{ fontSize: 36, fontWeight: 300, color: "#fff", marginBottom: 16, letterSpacing: "-0.01em" }}>
            Ready to Fill Your Pipeline?
          </h2>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.9)", marginBottom: 32, lineHeight: 1.6 }}>
            14-day free trial. No credit card. Tell us what you sell — we&apos;ll show you the leads.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link
              href="/dashboard"
              style={{
                background: "#fff", color: "var(--terracotta)", textDecoration: "none",
                padding: "14px 32px", fontSize: 14, borderRadius: 10, fontWeight: 600,
                display: "inline-block",
              }}
            >
              Start Free Trial
            </Link>
            <Link
              href="/landing-page/pricing"
              style={{
                background: "rgba(255,255,255,0.15)", color: "#fff", textDecoration: "none",
                padding: "14px 32px", fontSize: 14, borderRadius: 10, fontWeight: 500,
                border: "1px solid rgba(255,255,255,0.3)", display: "inline-block",
              }}
            >
              View Pricing →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
