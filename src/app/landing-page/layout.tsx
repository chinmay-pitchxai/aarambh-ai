import Link from "next/link";
import Image from "next/image";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <header style={{
        borderBottom: "1px solid var(--border)",
        background: "rgba(253,252,248,0.8)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <div style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <Link href="/landing-page" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "var(--accent-soft)",
              border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Image src="/favicon.png" alt="AarambhAI" width={20} height={20} style={{ objectFit: "contain" }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 500, letterSpacing: "0.1em", color: "var(--text)", fontFamily: "Playfair Display, serif" }}>AARAMBHAI</span>
          </Link>

          <nav style={{ display: "flex", gap: 32, alignItems: "center" }}>
            {[
              { href: "/landing-page/features", label: "Features" },
              { href: "/landing-page/pricing", label: "Pricing" },
              { href: "/landing-page/about", label: "About" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                style={{
                  color: "var(--text-dim)",
                  textDecoration: "none",
                  fontSize: 13,
                  letterSpacing: "0.03em",
                  fontWeight: 500,
                  fontFamily: "Playfair Display, serif",
                }}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/dashboard"
              className="btn-lift"
              style={{
                background: "var(--accent)", color: "#fff", textDecoration: "none",
                padding: "9px 22px", fontSize: 12, borderRadius: 8, fontWeight: 500,
                letterSpacing: "0.04em",
                fontFamily: "Playfair Display, serif",
              }}
            >
              Open App →
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        {/* Footer links */}
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px 32px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 48, marginBottom: 40 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: "var(--accent-soft)", border: "1px solid var(--border)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Image src="/favicon.png" alt="AarambhAI" width={16} height={16} style={{ objectFit: "contain" }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "0.1em", color: "var(--text)", fontFamily: "Playfair Display, serif" }}>AARAMBHAI</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.7, maxWidth: 280 }}>
                Zero-leakage AI GTM engine. From lead sourcing to booked meetings — fully autonomous.
              </p>
            </div>
            {[
              { title: "Product", items: [{ label: "Features", href: "/landing-page/features" }, { label: "Pricing", href: "/landing-page/pricing" }, { label: "Dashboard", href: "/dashboard" }] },
              { title: "Company", items: [{ label: "About", href: "/landing-page/about" }, { label: "Contact", href: "mailto:hello@aarambhai.com" }, { label: "Careers", href: "/landing-page/about" }] },
              { title: "Legal", items: [{ label: "Privacy", href: "#" }, { label: "Terms", href: "#" }, { label: "DPA", href: "#" }] },
            ].map((col) => (
              <div key={col.title}>
                <h4 style={{
                  fontSize: 10, color: "var(--text-light)", letterSpacing: "0.12em",
                  textTransform: "uppercase", marginBottom: 16, fontWeight: 600,
                  fontFamily: "Playfair Display, serif",
                }}>{col.title}</h4>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {col.items.map((item) => (
                    <li key={item.label} style={{ marginBottom: 10 }}>
                      <Link href={item.href} className="footer-link" style={{
                        color: "var(--text-dim)", textDecoration: "none", fontSize: 13, lineHeight: 1.8,
                      }}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-light)", letterSpacing: "0.02em" }}>
              © 2026 AarambhAI · A PitchX Solutions LLP · Bangalore, India
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              {["Twitter", "LinkedIn", "GitHub"].map((s) => (
                <a key={s} href="#" className="footer-link" style={{ color: "var(--text-light)", textDecoration: "none", fontSize: 12 }}>{s}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
