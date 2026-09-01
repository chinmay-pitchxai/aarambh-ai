import { pgTable, text, integer, boolean, jsonb, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";

export const leadBand = pgEnum("lead_band", ["hot", "warm", "interested", "cold"]);
export const leadStatus = pgEnum("lead_status", ["new", "contacted", "qualified", "converted", "booked", "parked", "dnc", "lost"]);
export const callOutcome = pgEnum("call_outcome", ["no_answer", "failed", "not_interested", "interested", "booked", "picked_no_response"]);
export const consentStatus = pgEnum("consent_status", ["opted_in", "opted_out", "unknown"]);
export const subscriptionStatus = pgEnum("subscription_status", ["active", "trialing", "past_due", "canceled", "expired"]);
export const membershipRole = pgEnum("membership_role", ["owner", "admin", "member", "viewer"]);

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
  attemptCount: integer("attempt_count").default(0),
  lastCallAt: timestamp("last_call_at"),
  nextRetryAt: timestamp("next_retry_at"),
  lostAt: timestamp("lost_at"),
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
  attemptNumber: integer("attempt_number").default(1),
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

export const bookings = pgTable("bookings", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  clientId: text("client_id").notNull(),
  callId: text("call_id"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  durationMin: integer("duration_min").default(30),
  status: text("status").default("scheduled"), // scheduled | confirmed | completed | cancelled | no_show
  reminderDayBeforeSent: boolean("reminder_day_before_sent").default(false),
  reminderDayOfSent: boolean("reminder_day_of_sent").default(false),
  meetingUrl: text("meeting_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_bookings_client_status").on(t.clientId, t.status),
  index("idx_bookings_scheduled").on(t.scheduledAt),
]);

// ── Inbound Messages ──
export const inboundMessages = pgTable("inbound_messages", {
  id: text("id").primaryKey(),
  leadId: text("lead_id").notNull(),
  clientId: text("client_id").notNull(),
  channel: text("channel").notNull(),       // "whatsapp" | "email"
  body: text("body"),
  detectedInterest: boolean("detected_interest").default(false),
  processedAt: timestamp("processed_at"),
  receivedAt: timestamp("received_at").defaultNow(),
}, (t) => [
  index("idx_inbound_lead").on(t.leadId),
  index("idx_inbound_client").on(t.clientId),
]);

// ── Auth Tables ──
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),  // null for Google-only users
  name: text("name"),
  avatarUrl: text("avatar_url"),
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_users_email").on(t.email),
]);

export const oauthAccounts = pgTable("oauth_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_accounts_provider").on(t.provider, t.providerAccountId),
  index("idx_accounts_user").on(t.userId),
]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activeOrganizationId: text("active_organization_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_sessions_user").on(t.userId),
  index("idx_sessions_expires").on(t.expiresAt),
]);

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const organizationMembers = pgTable("organization_members", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: membershipRole("role").default("member"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_org_member").on(t.organizationId, t.userId),
]);

export const businessProfiles = pgTable("business_profiles", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyName: text("company_name"),
  location: text("location"),
  category: text("category"),
  description: text("description"),
  website: text("website"),
  industry: text("industry"),
  profileData: jsonb("profile_data"),
  researchStatus: text("research_status").default("pending"),
  researchSources: jsonb("research_sources"),
  confidenceScore: integer("confidence_score"),
  lastResearchedAt: timestamp("last_researched_at"),
  rawResearchData: jsonb("raw_research_data"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_biz_org").on(t.organizationId),
]);
