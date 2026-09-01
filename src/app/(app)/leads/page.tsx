"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LeadPopup from "@/components/LeadPopup";

interface Lead {
  id: string;
  leadId: string;
  score: number | null;
  band: string | null;
  status: string | null;
  reusedFrom: string | null;
  assignedAt: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  city: string | null;
  industry: string | null;
}

type ColumnKey = "icp" | "interested" | "warm" | "hot" | "booked" | "meetings";

const COLUMNS: { key: ColumnKey; label: string; sublabel: string; color: string }[] = [
  { key: "icp", label: "ICP", sublabel: "New leads", color: "#B0A9A0" },
  { key: "interested", label: "Interested", sublabel: "Showed interest", color: "#D4A08C" },
  { key: "warm", label: "Warm Lead", sublabel: "Band warm", color: "#D4B87A" },
  { key: "hot", label: "Hot Lead", sublabel: "Band hot", color: "#C17C60" },
  { key: "booked", label: "Calls Booked", sublabel: "Qualified", color: "#8A9A8B" },
  { key: "meetings", label: "Meetings Over", sublabel: "Converted", color: "#7A9A7E" },
];

function getColumn(lead: Lead): ColumnKey {
  if (lead.status === "converted") return "meetings";
  if (lead.status === "qualified" || lead.status === "converted") return "booked";
  if (lead.band === "hot") return "hot";
  if (lead.band === "warm") return "warm";
  if (lead.band === "interested") return "interested";
  return "icp";
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [activeCol, setActiveCol] = useState<ColumnKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: "1", limit: "100" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    fetch(`/api/leads?${params}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setLeads(d.leads || []); setTotal(d.total || 0); })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message || "Failed to load leads");
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debouncedSearch]);

  const grouped = COLUMNS.map((col) => ({
    ...col,
    items: leads.filter((l) => getColumn(l) === col.key),
  }));

  const activeLeads = activeCol ? leads.filter((l) => getColumn(l) === activeCol) : [];
  const activeLabel = activeCol ? COLUMNS.find((c) => c.key === activeCol)?.label : "";

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 300, letterSpacing: "0.02em", margin: 0 }}>Leads</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 6, letterSpacing: "0.02em" }}>
          {total} leads — click a stage to view its leads
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <input
          type="text"
          placeholder="Search name, company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
            padding: "10px 14px", color: "var(--text)", fontSize: 14, width: 280, outline: "none",
          }}
        />
      </div>

      {error && (
        <div style={{ background: "rgba(193,124,96,0.1)", border: "1px solid rgba(193,124,96,0.3)", borderRadius: 10, padding: 12, marginBottom: 16, color: "var(--terracotta)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "var(--text-light)", letterSpacing: "0.06em", fontSize: 13, textTransform: "uppercase" }}>Loading leads —</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
            {grouped.map((col) => {
              const isActive = activeCol === col.key;
              return (
                <div
                  key={col.key}
                  onClick={() => setActiveCol(isActive ? null : col.key)}
                  style={{
                    background: isActive ? "var(--surface)" : "var(--surface-2)", borderRadius: 16, padding: 12,
                    border: `1px solid ${isActive ? col.color : "var(--border)"}`, minWidth: 0,
                    cursor: "pointer", boxShadow: isActive ? `0 2px 12px ${col.color}22` : "none",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: col.color }} />
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text)" }}>{col.label}</span>
                    <span style={{ fontSize: 11, color: isActive ? "#fff" : "var(--text-light)", marginLeft: "auto", background: isActive ? col.color : "var(--surface)", padding: "2px 8px", borderRadius: 10 }}>{col.items.length}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-light)", marginBottom: 12, letterSpacing: "0.02em" }}>{col.sublabel}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {col.items.length === 0 ? (
                      <div style={{ padding: 12, textAlign: "center", color: "var(--text-light)", fontSize: 11, border: "1px dashed var(--border)", borderRadius: 10 }}>No leads</div>
                    ) : (
                      col.items.slice(0, 3).map((lead) => (
                        <div
                          key={lead.id}
                          onClick={(event) => { event.stopPropagation(); setSelectedLeadId(lead.leadId); }}
                          style={{
                            background: "var(--surface)", borderRadius: 10, padding: 10,
                            border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                            cursor: "pointer",
                            transition: "border-color 0.15s, box-shadow 0.15s",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = col.color; e.currentTarget.style.boxShadow = `0 2px 8px ${col.color}22`; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04)"; }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {lead.firstName} {lead.lastName || ""}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {lead.company || "—"}
                          </div>
                        </div>
                      ))
                    )}
                    {col.items.length > 3 && (
                      <div style={{ fontSize: 11, color: "var(--accent)", textAlign: "center", padding: 4, letterSpacing: "0.04em" }}>
                        +{col.items.length - 3} more — click to view
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {activeCol && (
            <div className="glow-card" style={{ padding: 0, overflow: "hidden", marginTop: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 5, background: COLUMNS.find((c) => c.key === activeCol)?.color }} />
                  <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "0.04em" }}>{activeLabel}</span>
                  <span style={{ fontSize: 12, color: "var(--text-light)", background: "var(--surface-2)", padding: "2px 8px", borderRadius: 10 }}>{activeLeads.length} leads</span>
                </div>
                <button
                  onClick={() => setActiveCol(null)}
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "var(--text-dim)", cursor: "pointer" }}
                >
                  Close
                </button>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Company</th><th>Title</th><th>Band</th><th>Score</th><th>City</th>
                  </tr>
                </thead>
                <tbody>
                  {activeLeads.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-dim)" }}>No leads in {activeLabel}</td></tr>
                  ) : (
                    activeLeads.map((lead) => (
                      <tr
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.leadId)}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={{ fontWeight: 500, color: "var(--accent)" }}>{lead.firstName} {lead.lastName}</td>
                        <td>{lead.company || "—"}</td>
                        <td style={{ color: "var(--text-dim)", fontSize: 13 }}>{lead.title || "—"}</td>
                        <td>{lead.band ? <span className={`badge badge-${lead.band}`}>{lead.band}</span> : "—"}</td>
                        <td style={{ fontWeight: 600 }}>{lead.score ?? "—"}</td>
                        <td style={{ color: "var(--text-dim)" }}>{lead.city || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {selectedLeadId && (
        <LeadPopup leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
      )}
    </div>
  );
}
