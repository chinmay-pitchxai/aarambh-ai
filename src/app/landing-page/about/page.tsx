"use client";

import Link from "next/link";

const NUMBERS = [
  { value: "500+", label: "Revenue Teams", color: "var(--accent)" },
  { value: "10K+", label: "Meetings Booked", color: "var(--terracotta)" },
  { value: "₹2Cr+", label: "Spend Saved Monthly", color: "var(--amber)" },
  { value: "4.8/5", label: "Customer Rating", color: "var(--green)" },
];

const TIMELINE = [
  { date: "Jan 2024", title: "The Problem", desc: "Cold calling in India is broken. Manual dialling, no AI, no follow-up automation. Leads leak everywhere.", color: "var(--text-dim)" },
  { date: "Apr 2024", title: "Founded", desc: "AarambhAI started in Bangalore. Mission: zero leakage. Every lead tracked, every call timed, every follow-up automated.", color: "var(--accent)" },
  { date: "Jul 2024", title: "Beta Launch", desc: "10 design partners. First 100 meetings booked. The pipeline works. Zero leads dropped.", color: "var(--accent)" },
  { date: "Oct 2024", title: "Series A", desc: "$4M raised. Team grows to 12. Voice calling and lead sourcing integrations ship. Speed to first call drops under 5 minutes.", color: "var(--terracotta)" },
  { date: "Jan 2025", title: "Scale", desc: "500+ teams live. 10,000+ meetings booked. WhatsApp nurture launches. Cost per meeting drops to ₹99.", color: "var(--amber)" },
  { date: "Today", title: "Building", desc: "Continuous improvement. New AI models. Deeper integrations. Better outcomes. Zero leakage, always.", color: "var(--green)" },
];

const TEAM = [
  { name: "Arjun Sharma", role: "Founder & CEO", initials: "AS", bio: "Ex-Salesforce. Built 3 outbound teams from scratch. Obsessed with making cold calls warm.", color: "var(--accent)" },
  { name: "Neha Patel", role: "Head of Engineering", initials: "NP", bio: "ML PhD from IIT Bombay. Previously at Google AI. Builds the models that qualify leads in real-time.", color: "var(--terracotta)" },
  { name: "Vikram Rao", role: "Head of Product", initials: "VR", bio: "Built product-led growth at 2 unicorns. Turns complex pipelines into simple interfaces.", color: "var(--amber)" },
  { name: "Ananya Singh", role: "Head of Growth", initials: "AS", bio: "Ex-HubSpot India. Scaled ARR from $0 to $10M. Knows every trick in B2B SaaS.", color: "var(--green)" },
  { name: "Rohit Menon", role: "Lead Engineer", initials: "RM", bio: "Full-stack polyglot. Previously at Freshworks. Makes pipelines run at scale without dropping a single lead.", color: "var(--accent)" },
  { name: "Kavya Nair", role: "Head of CS", initials: "KN", bio: "Ex-Zoho. Ensures every team using AarambhAI hits their meeting targets. Zero leakage is her mantra.", color: "var(--terracotta)" },
];

const VALUES = [
  { title: "Zero Leakage", desc: "Every lead is tracked. No lead is ever dropped, forgotten, or called twice. This is our north star.", icon: "🎯", color: "var(--accent)" },
  { title: "Speed Wins", desc: "78% of buyers choose the first responder. We call in under 5 minutes. Speed beats everything.", icon: "⚡", color: "var(--terracotta)" },
  { title: "Transparent Always", desc: "Open pricing, open metrics, open communication. ₹99 per meeting. No hidden costs, no surprises.", icon: "🔍", color: "var(--amber)" },
  { title: "India First", desc: "Built for Indian B2B sales. NDNC compliance, local phone numbers, WhatsApp native. Made in Bangalore.", icon: "🇮🇳", color: "var(--green)" },
];

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section style={{ padding: "80px 0 56px", background: "var(--bg)" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
          <div className="animate-fade-in-up" style={{
            display: "inline-block", padding: "6px 16px", borderRadius: 20,
            background: "var(--accent-soft)", color: "var(--accent)",
            fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            marginBottom: 20,
          }}>
            Our Story
          </div>
          <h1 className="animate-fade-in-up delay-1" style={{ fontSize: 44, fontWeight: 400, color: "var(--text)", marginBottom: 16 }}>
            We Exist Because<br />Deals Were Dying
          </h1>
          <p className="animate-fade-in-up delay-2" style={{ fontSize: 17, color: "var(--text-dim)", lineHeight: 1.7 }}>
            The #1 reason deals die isn&apos;t price. It&apos;s speed. AarambhAI was built to fix that — call every lead in under 5 minutes, qualify them on the phone, follow up forever, and hand your team only the people worth meeting.
          </p>
        </div>
      </section>

      {/* Numbers */}
      <section style={{ padding: "48px 0", background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {NUMBERS.map((n, i) => (
              <div key={n.label} className={`lp-card animate-fade-in-up delay-${i + 1}`} style={{
                textAlign: "center", padding: "28px 16px",
                background: "var(--bg)", borderRadius: 14, border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: 36, fontWeight: 400, color: n.color, marginBottom: 8, fontFamily: "Playfair Display, serif" }}>{n.value}</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{n.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mission + Values */}
      <section style={{ padding: "80px 0", background: "var(--bg)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div className="animate-fade-in-up" style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Mission</div>
            <h1 className="animate-fade-in-up delay-1" style={{ fontSize: 32, fontWeight: 400, color: "var(--text)", marginBottom: 16, fontFamily: "Playfair Display, serif" }}>
              Every B2B company deserves a pipeline that works while they sleep
            </h1>
            <p className="animate-fade-in-up delay-2" style={{ fontSize: 15, color: "var(--text-dim)", maxWidth: 600, margin: "0 auto", lineHeight: 1.7 }}>
              We build AI agents that source, qualify, dial, and follow up — so sales teams can focus on closing. Tell us what you sell. We bring you leads.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 }}>
            {VALUES.map((v, i) => (
              <div key={v.title} className={`value-card animate-fade-in-up delay-${i + 1}`} style={{
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16,
                padding: 32, display: "flex", gap: 16, alignItems: "flex-start",
              }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                  background: `${v.color}12`, color: v.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 22,
                }}>{v.icon}</div>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 8, fontFamily: "Playfair Display, serif" }}>{v.title}</h3>
                  <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.6 }}>{v.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section style={{ padding: "80px 0", background: "var(--surface)" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Timeline</div>
            <h1 style={{ fontSize: 32, fontWeight: 400, color: "var(--text)", fontFamily: "Playfair Display, serif" }}>Our Journey</h1>
          </div>
          <div style={{ position: "relative" }}>
            {/* Gradient line */}
            <div style={{
              position: "absolute", left: 19, top: 0, bottom: 0,
              width: 2,
              background: "linear-gradient(to bottom, var(--border), var(--accent), var(--terracotta), var(--amber), var(--green))",
              borderRadius: 1,
            }} />
            {TIMELINE.map((item, i) => (
              <div key={item.date} className={`animate-fade-in-up delay-${i + 1}`} style={{
                display: "flex", gap: 24, marginBottom: i < TIMELINE.length - 1 ? 28 : 0,
                position: "relative",
              }}>
                <div style={{
                  width: 40, height: 40, flexShrink: 0,
                  borderRadius: "50%",
                  background: i === TIMELINE.length - 1 ? item.color : "var(--surface)",
                  border: `2px solid ${item.color}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 1,
                  transition: "transform 0.2s ease",
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: i === TIMELINE.length - 1 ? "#fff" : item.color,
                  }} />
                </div>
                <div style={{
                  paddingBottom: 8, flex: 1,
                  background: "var(--bg)", borderRadius: 12, padding: "16px 20px",
                  border: "1px solid var(--border)",
                  transition: "border-color 0.2s, box-shadow 0.2s",
                }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = item.color;
                    e.currentTarget.style.boxShadow = `0 4px 16px rgba(0,0,0,0.04)`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{ fontSize: 11, color: item.color, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4, fontWeight: 600 }}>{item.date}</div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 6, fontFamily: "Playfair Display, serif" }}>{item.title}</h3>
                  <p style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1.6, margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team */}
      <section style={{ padding: "80px 0", background: "var(--bg)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <div style={{ fontSize: 11, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 600 }}>Team</div>
            <h1 style={{ fontSize: 32, fontWeight: 400, color: "var(--text)", fontFamily: "Playfair Display, serif" }}>The People Behind AarambhAI</h1>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
            {TEAM.map((m, i) => (
              <div key={m.name} className={`team-card animate-fade-in-up delay-${i + 1}`} style={{
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16,
                padding: 32, textAlign: "center",
              }}>
                <div
                  className="team-avatar"
                  style={{
                    width: 72, height: 72, borderRadius: "50%", margin: "0 auto 20px",
                    background: `${m.color}12`, border: `2px solid ${m.color}30`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.25s ease",
                  }}
                >
                  <span style={{ fontSize: 22, fontWeight: 500, color: m.color, fontFamily: "Playfair Display, serif" }}>{m.initials}</span>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4, fontFamily: "Playfair Display, serif" }}>{m.name}</h3>
                <div style={{
                  fontSize: 11, color: m.color, letterSpacing: "0.06em", textTransform: "uppercase",
                  marginBottom: 12, fontWeight: 600,
                }}>{m.role}</div>
                <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>{m.bio}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding: "56px 0", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "0 24px", textAlign: "center" }}>
          <h2 style={{ fontSize: 28, fontWeight: 400, color: "var(--text)", marginBottom: 16, fontFamily: "Playfair Display, serif" }}>Join Us on This Journey</h2>
          <p style={{ fontSize: 15, color: "var(--text-dim)", marginBottom: 28 }}>We&apos;re hiring across engineering, product, and growth. Come build the future of B2B outbound.</p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Link href="/auth/login" className="btn-lift" style={{
              background: "var(--accent)", color: "#fff", textDecoration: "none",
              padding: "12px 28px", fontSize: 13, borderRadius: 8, fontWeight: 500,
              fontFamily: "Playfair Display, serif",
            }}>Start Free Trial</Link>
            <Link href="/landing-page/features" style={{
              background: "var(--bg)", color: "var(--text)", textDecoration: "none",
              padding: "12px 28px", fontSize: 13, borderRadius: 8, fontWeight: 500,
              border: "1px solid var(--border)",
              fontFamily: "Playfair Display, serif",
            }}>View Features</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
