"use client";

import { useState, useRef, useEffect } from "react";

interface Msg { role: "user" | "agent"; text: string }

export default function RightSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "agent", text: "Hi! Tell me what to automate — e.g. “Call hot leads daily at 10am” or “Send WA to warm leads every Monday”" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);

    // Mock: parse intent and call automation API
    try {
      // Simple intent: if contains "call" or "leads" → trigger pipeline
      const isAutomation = /call|leads|automation|schedule/i.test(text);
      if (isAutomation) {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: "demo", icpTags: ["saas"], batchSize: 5 }),
        });
        const data = await res.json();
        setMsgs((m) => [...m, { role: "agent", text: `✓ Automation created — ${data.scout?.leadsFound || 0} leads queued. Will run daily. Check Dashboard.` }]);
      } else {
        setMsgs((m) => [...m, { role: "agent", text: `Got it: “${text}” — I can create automations like:\n• “Call hot leads every morning”\n• “Follow up warm leads via WhatsApp”\nTry one!` }]);
      }
    } catch {
      setMsgs((m) => [...m, { role: "agent", text: "Something went wrong — try again." }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <aside style={{
      width: 360, height: "100vh", background: "var(--surface)", borderLeft: "1px solid var(--border)",
      position: "fixed", right: 0, top: 0, zIndex: 50, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, letterSpacing: "0.04em" }}>Automation Agent</div>
          <div style={{ fontSize: 11, color: "var(--text-light)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Chat to create</div>
        </div>
        <button onClick={onClose} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: "var(--text-dim)" }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            background: m.role === "user" ? "var(--accent)" : "var(--surface-2)",
            color: m.role === "user" ? "#fff" : "var(--text)",
            borderRadius: 12, padding: "10px 14px", maxWidth: "85%", fontSize: 13, lineHeight: 1.5,
            border: `1px solid ${m.role === "user" ? "var(--accent)" : "var(--border)"}`, whiteSpace: "pre-wrap",
          }}>
            {m.text}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type automation..."
          style={{ flex: 1, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none", color: "var(--text)" }}
        />
        <button onClick={send} disabled={busy} className="btn-primary" style={{ padding: "10px 16px", opacity: busy ? 0.5 : 1 }}>Send</button>
      </div>
    </aside>
  );
}
