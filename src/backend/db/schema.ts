import { pgTable, text, integer, jsonb, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";

export const leadBand = pgEnum("lead_band", ["hot", "warm", "interested", "cold"]);
export const leadStatus = pgEnum("lead_status", ["new", "contacted", "qualified", "converted", "parked", "dnc"]);
export const callOutcome = pgEnum("call_outcome", ["no_answer", "failed", "not_interested", "interested", "booked"]);
export const consentStatus = pgEnum("consent_status", ["opted_in", "opted_out", "unknown"]);

// ── Mother Leads DB (global, cross-client) ──
export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  phoneE164: text("phone_e164").notNull(),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  company: text("company"),
  title: text("title"),
  city: text("city"),
  industry: text("industry"),
  companySize: text("company_size"),
  sourceRef: text("source_ref"),           // apollo id / place_id
  sourceCost: integer("source_cost").default(0), // paise
  rawData: jsonb("raw_data"),
  icpTags: jsonb("icp_tags"),              // ["vp-sales","saas","bangalore"]
  freshness: timestamp("freshness"),        // last enriched
  dnc: integer("dnc").default(0),          // 0=no, 1=yes
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_leads_phone").on(t.phoneE164),
  index("idx_leads_email").on(t.email),
  index("idx_leads_icp").using("gin", t.icpTags),
]);

// ── Client Leads (per-client view of mother leads) ──
export const clientLeads = pgTable("client_leads", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  leadId: text("lead_id").notNull(),
  reusedFrom: text("reused_from"),          // null = first client, else client_id
  score: integer("score"),                  // 1-100 per client ICP
  band: leadBand("band"),
  status: leadStatus("status").default("new"),
  assignedAt: timestamp("assigned_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_client_lead").on(t.clientId, t.leadId),
  index("idx_client_status").on(t.clientId, t.status),
]);

// ── Calls ──
export const calls = pgTable("calls", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  clientId: text("client_id").notNull(),
  vobizCallId: text("vobiz_call_id"),
  outcome: callOutcome("outcome"),
  durationSec: integer("duration_sec"),
  transcript: jsonb("transcript"),          // full turn array
  bant: jsonb("bant"),                      // {budget,authority,need,timeline}
  sentiment: text("sentiment"),              // positive/neutral/negative
  pitchUsed: text("pitch_used"),
  summary: text("summary"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
}, (t) => [
  index("idx_calls_lead").on(t.leadId),
  index("idx_calls_client").on(t.clientId),
]);

// ── Messages (WhatsApp + Gmail) ──
export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  clientId: text("client_id").notNull(),
  callId: text("call_id"),
  channel: text("channel").notNull(),       // "whatsapp" | "gmail"
  direction: text("direction").notNull(),   // "outbound" | "inbound"
  body: text("body"),
  waMessageId: text("wa_message_id"),
  gmailThreadId: text("gmail_thread_id"),
  templateName: text("template_name"),
  sentAt: timestamp("sent_at").defaultNow(),
}, (t) => [
  index("idx_messages_lead").on(t.leadId),
]);

// ── Consent ──
export const consent = pgTable("consent", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  clientId: text("client_id").notNull(),
  status: consentStatus("status").default("unknown"),
  source: text("source"),                   // "apollo" | "form" | "manual"
  checkedAt: timestamp("checked_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_consent_lead_client").on(t.leadId, t.clientId),
]);

// ── Retry Queue ──
export const retryQueue = pgTable("retry_queue", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  clientId: text("client_id").notNull(),
  callId: text("call_id"),
  attempt: integer("attempt").default(1),
  reason: text("reason"),                   // "no_answer" | "failed"
  nextAttemptAt: timestamp("next_attempt_at"),
  maxAttempts: integer("max_attempts").default(3),
  status: text("status").default("pending"), // pending | done | exhausted
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_retry_pending").on(t.status, t.nextAttemptAt),
]);

// ── KPI Daily ──
export const kpiDaily = pgTable("kpi_daily", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  date: text("date").notNull(),             // "2026-08-30"
  leadsPulled: integer("leads_pulled").default(0),
  leadsReused: integer("leads_reused").default(0),
  callsMade: integer("calls_made").default(0),
  callsAnswered: integer("calls_answered").default(0),
  meetingsBooked: integer("meetings_booked").default(0),
  costApollo: integer("cost_apollo").default(0),
  costVobiz: integer("cost_vobiz").default(0),
  costGemini: integer("cost_gemini").default(0),
}, (t) => [
  uniqueIndex("idx_kpi_client_date").on(t.clientId, t.date),
]);

// ── Clients ──
export const clients = pgTable("clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icpTags: jsonb("icp_tags"),
  whatsappSession: text("whatsapp_session"),  // "active" | "expired"
  createdAt: timestamp("created_at").defaultNow(),
});

// ── OAuth Connections ──
export const oauthConnections = pgTable("oauth_connections", {
  id: text("id").$defaultFn(() => `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`).primaryKey(),
  clientId: text("client_id").notNull(),
  integration: text("integration").notNull(),   // "gmail", "apollo", "whatsapp", etc.
  composioConnectionId: text("composio_connection_id"),
  accountEmail: text("account_email"),
  credentials: jsonb("credentials"),            // direct API keys: { apiKey, apiSecret, ... }
  status: text("status").default("pending"),   // pending | active | error
  error: text("error"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_oauth_client_integration").on(t.clientId, t.integration),
  index("idx_oauth_status").on(t.status),
]);
