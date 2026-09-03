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
  phoneE164: text("phone_e164"),
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
  recordingUrl: text("recording_url"),
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
  idempotencyKey: text("idempotency_key"),
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
  icp: jsonb("icp"),
  icpVersion: integer("icp_version").default(1),
  ragData: jsonb("rag_data"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_biz_org").on(t.organizationId),
]);

// ── Prompt Templates (per-tenant sales prompts) ──
export const promptTemplates = pgTable("prompt_templates", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => businessProfiles.id, { onDelete: "cascade" }),
  promptType: text("prompt_type").notNull(),   // "master" | "discovery" | "qualification" | "objection" | "closing"
  promptVersion: integer("prompt_version").default(1),
  systemPrompt: text("system_prompt"),
  openingPrompt: text("opening_prompt"),
  behaviorPrompt: text("behavior_prompt"),
  qualificationPrompt: text("qualification_prompt"),
  pitchPrompt: text("pitch_prompt"),
  objectionPrompt: text("objection_prompt"),
  closingPrompt: text("closing_prompt"),
  status: text("status").default("draft"),    // "draft" | "active" | "archived"
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_prompt_tenant").on(t.tenantId),
  index("idx_prompt_company").on(t.companyId),
  uniqueIndex("idx_prompt_type_version").on(t.companyId, t.promptType, t.promptVersion),
]);

// ── Enums for new systems ──
export const eventStatus = pgEnum("event_status", ["pending", "published", "failed"]);
export const webhookStatus = pgEnum("webhook_status", ["received", "processing", "completed", "failed"]);
export const membershipRole2 = pgEnum("membership_role2", ["owner", "admin", "member", "viewer"]);

// ── Billing: Plans ──
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  interval: text("interval").notNull().default("monthly"),
  priceCents: integer("price_cents").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  entitlementsJson: jsonb("entitlements_json").notNull(),
  active: boolean("active").default(true),
  version: integer("version").default(1),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ── Billing: Subscriptions ──
export const subscriptions = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().references(() => plans.id),
  status: subscriptionStatus("status").default("active"),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_sub_org").on(t.organizationId),
]);

// ── Billing: Payments ──
export const payments = pgTable("payments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  subscriptionId: text("subscription_id").references(() => subscriptions.id),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("pending"),
  providerRef: text("provider_ref"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_payments_org").on(t.organizationId),
]);

// ── Billing: Wallets ──
export const wallets = pgTable("wallets", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  balanceCents: integer("balance_cents").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_wallets_org").on(t.organizationId),
]);

// ── Billing: Wallet Transactions ──
export const walletTransactions = pgTable("wallet_transactions", {
  id: text("id").primaryKey(),
  walletId: text("wallet_id").notNull().references(() => wallets.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  description: text("description"),
  idempotencyKey: text("idempotency_key").unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Billing: Entitlement Usage ──
export const entitlementUsage = pgTable("entitlement_usage", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: text("plan_id").notNull().references(() => plans.id),
  reservationId: text("reservation_id").unique(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  resource: text("resource").notNull(),
  used: integer("used").default(0),
  reserved: integer("reserved").default(0),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_ent_org_resource").on(t.organizationId, t.resource),
]);

// ── Telephony: Phone Numbers ──
export const phoneNumbers = pgTable("phone_numbers", {
  id: text("id").primaryKey(),
  numberE164: text("number_e164").notNull(),
  provider: text("provider").default("vobiz"),
  status: text("status").default("available"),
  tenantId: text("tenant_id").references(() => organizations.id, { onDelete: "set null" }),
  provisionedAt: timestamp("provisioned_at").defaultNow(),
  assignedAt: timestamp("assigned_at"),
  releasedAt: timestamp("released_at"),
}, (t) => [
  index("idx_phone_tenant").on(t.tenantId),
  uniqueIndex("idx_phone_number").on(t.numberE164),
]);

// ── Telephony: Call Events ──
export const callEvents = pgTable("call_events", {
  id: text("id").primaryKey(),
  callId: text("call_id").notNull(),
  eventType: text("event_type").notNull(),
  payloadJson: jsonb("payload_json"),
  idempotencyKey: text("idempotency_key").unique(),
  receivedAt: timestamp("received_at").defaultNow(),
}, (t) => [
  index("idx_call_events_call").on(t.callId),
  index("idx_call_events_type").on(t.eventType),
]);

// ── Runtime: Graph Runs ──
export const graphRuns = pgTable("graph_runs", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  graphName: text("graph_name").notNull(),
  threadId: text("thread_id").notNull(),
  status: text("status").default("pending"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  error: text("error"),
  input: jsonb("input"),
  output: jsonb("output"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_graph_tenant").on(t.tenantId),
  index("idx_graph_thread").on(t.threadId),
  uniqueIndex("idx_graph_thread_unique").on(t.threadId),
]);

// ── Runtime: Agent Runs ──
export const agentRuns = pgTable("agent_runs", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  graphRunId: text("graph_run_id").notNull().references(() => graphRuns.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  status: text("status").default("pending"),
  input: jsonb("input"),
  output: jsonb("output"),
  error: text("error"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_agent_graph").on(t.graphRunId),
]);

// ── Runtime: Tool Executions ──
export const toolExecutions = pgTable("tool_executions", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  agentRunId: text("agent_run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  input: jsonb("input"),
  output: jsonb("output"),
  status: text("status").default("pending"),
  idempotencyKey: text("idempotency_key").unique(),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Runtime: Queue Jobs ──
export const queueJobs = pgTable("queue_jobs", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id"),
  clientId: text("client_id"),
  queue: text("queue"),
  jobType: text("job_type"),
  type: text("type").notNull(),
  payload: jsonb("payload"),
  status: text("status").default("pending"),
  priority: text("priority"),
  attempt: integer("attempt").default(0),
  maxAttempts: integer("max_attempts").default(5),
  correlationId: text("correlation_id"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  runAt: timestamp("run_at"),
  runAfter: timestamp("run_after"),
  processedAt: timestamp("processed_at"),
}, (t) => [
  index("idx_queue_tenant").on(t.tenantId),
  index("idx_queue_status").on(t.status),
]);

// ── Events: Outbox ──
export const outboxEvents = pgTable("outbox_events", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").references(() => organizations.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  aggregateType: text("aggregate_type"),
  aggregateId: text("aggregate_id"),
  payload: jsonb("payload").notNull(),
  status: eventStatus("status").default("pending"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_outbox_tenant").on(t.tenantId),
  index("idx_outbox_status").on(t.status),
]);

// ── Events: Inbox ──
export const inboxEvents = pgTable("inbox_events", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").references(() => organizations.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  eventType: text("event_type"),
  payload: jsonb("payload").notNull(),
  status: eventStatus("status").default("pending"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("idx_inbox_dedup").on(t.tenantId, t.source, t.externalId),
  index("idx_inbox_tenant").on(t.tenantId),
]);

// ── Webhooks: Raw Event Storage ──
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").references(() => organizations.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  eventType: text("event_type").notNull(),
  headers: jsonb("headers"),
  payload: jsonb("payload").notNull(),
  status: webhookStatus("status").default("received"),
  processedAt: timestamp("processed_at"),
  error: text("error"),
  retryCount: integer("retry_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_webhook_tenant").on(t.tenantId),
  index("idx_webhook_source").on(t.source),
]);

// ── Security: Audit Logs ──
export const auditLogs = pgTable("audit_logs", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  action: text("action").notNull(),
  resource: text("resource"),
  resourceId: text("resource_id"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_audit_tenant").on(t.tenantId),
]);

// ── Security: Config Snapshots ──
export const configSnapshots = pgTable("config_snapshots", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  configType: text("config_type"),
  config: jsonb("config"),
  configJson: jsonb("config_json"),
  version: integer("version").default(1),
  isActive: boolean("is_active").default(true),
  checksum: text("checksum"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_config_tenant").on(t.tenantId),
]);

// ── Integration: Credentials ──
export const integrationCredentials = pgTable("integration_credentials", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  integration: text("integration").notNull(),
  credentialsEncrypted: text("credentials_encrypted"),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("idx_creds_tenant").on(t.tenantId),
]);

// ── Chat Messages (Dashboard Assistant) ──
export const chatMessages = pgTable("chat_messages", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  metadata: jsonb("metadata"), // tool results, token usage, etc.
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_chat_tenant").on(t.tenantId),
  index("idx_chat_user").on(t.userId),
]);

// ── Notifications ──
export const notifications = pgTable("notifications", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  type: text("type").notNull(), // "hot_lead" | "qualified_lead" | "interested" | "meeting_booked" | "call_completed" | "follow_up" | "dnc" | "system"
  title: text("title").notNull(),
  message: text("message"),
  leadId: text("lead_id"),
  callId: text("call_id"),
  meetingId: text("meeting_id"),
  read: boolean("read").default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_notif_tenant_user").on(t.tenantId, t.userId),
  index("idx_notif_unread").on(t.tenantId, t.userId, t.read),
  index("idx_notif_created").on(t.createdAt),
]);

// ── Calendar: Meeting Reminders ──
export const meetingReminders = pgTable("meeting_reminders", {
  id: text("id").$defaultFn(() => crypto.randomUUID()).primaryKey(),
  organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  clientId: text("client_id"),
  leadId: text("lead_id"),
  bookingId: text("booking_id").notNull(),
  type: text("type").notNull(),
  reminderType: text("reminder_type"),
  channel: text("channel"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  scheduledFor: timestamp("scheduled_for"),
  status: text("status").default("pending"),
  error: text("error"),
  sent: boolean("sent").default(false),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("idx_reminder_org").on(t.organizationId),
  index("idx_reminder_scheduled").on(t.scheduledAt),
]);
