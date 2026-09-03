# AarambhAI Production Upgrade Implementation Plan

## Executive decision

Preserve the existing Next.js UI and migrate the backend from an imperative, partially simulated pipeline to an event-driven, tenant-safe, durable LangGraph system. Do not extend the current in-memory bus, sequential batch loop, timer scheduler, mock-data fallbacks, or simulated provider outcomes.

The upgrade must begin with a green, secure baseline. LangGraph comes after fail-closed authentication, canonical tenant isolation, configuration validation, and migration reconciliation, but before expanding calling and omnichannel automation.

## Evidence-based current state

| Area | Current status | Reuse | Required upgrade |
|---|---|---|---|
| Frontend | Substantial | Landing pages, visual system, shell, dashboard, leads, activity, connections, wallet, onboarding modal | Keep design; connect only to live tenant data; add bookings, notifications, recordings, usage, integration health, AI assistant and realtime updates |
| Authentication | Partial and unsafe | Password hashing, session tables, login/signup/logout and Google routes | Remove dev bypasses and fallback secret; fix build; add verified sessions, OAuth state/PKCE, email verification/reset, CSRF, rotation and fail-closed behavior |
| Multi-tenancy | Partial | Organizations and memberships exist | Standardize on `tenant_id`, derive it server-side, enforce RBAC and PostgreSQL RLS, add tenant FKs/indexes and cross-tenant tests |
| Database | Partial with migration drift | Leads, client leads, calls, messages, consent, retry queue, KPI, bookings and auth tables | Create a reproducible baseline migration and add the missing production domain, orchestration, billing, messaging, media, webhook and audit tables |
| Business discovery | Partial | SSRF-aware website research, Apollo organization lookup and Gemini structured research | Split submit/research/confirm stages; persist evidence and profile versions; require confirmation before ICP or lead generation |
| ICP and lead acquisition | Partial | Apollo service and global lead-pool concept | Replace Scout stub; persist ICP/scoring versions; normalize, dedupe, enrich, measure quality; internal-first search; exactly three genuine samples |
| Agent runtime | Not production ready | Some useful domain logic in Scout, Ranker, Consent, Outcome Router, Retry, Reminder and Booking agents | Replace sequential pipeline with bounded LangGraph graphs, typed states, PostgreSQL checkpoints, durable queue, outbox/inbox and idempotent tool execution |
| Vobiz calling | Partial and simulated | Provider adapter shape and webhook route | Remove fake success/random outcomes; verify real provisioning/media capabilities; implement number inventory/provisioning, signed idempotent events, capacity and real voice runtime |
| Email/WhatsApp | Partial and unverified | Composio connection flow and inbound route shapes | Verify signatures, correlate tenant/lead server-side, persist threads/messages, maintain email threading and WhatsApp session/template compliance |
| Calendar/bookings | Partial | Booking table/routes and reminder logic | Add connections, free/busy, slot recheck, atomic booking, confirmations, reminders and double-book prevention |
| Billing/wallet | Missing behind static UI | Pricing and wallet UI can be reused | Server-owned plan catalog, verified payment state machine, subscriptions, append-only entitlements/usage ledger and atomic reservations |
| Recordings/transcripts | Missing/partial fields | Lead detail layout | Object storage, signed URLs, recording metadata, async transcription/diarization/summary and authorized playback |
| Realtime/observability | Missing | Existing dashboard query shapes | Durable event stream with SSE/WebSocket, structured logs, traces, metrics, alerts, correlation IDs and integration health |
| Tests/operations | Missing | None | Typecheck/lint/test scripts, CI, fresh-DB migrations, unit/integration/contract/replay/E2E/security/load tests and release gates |

## Immediate blockers

1. `npm run build` and `npx tsc --noEmit` fail in authentication/Google OAuth because schema imports resolve incorrectly.
2. Authentication can fall back to committed demo identities and credentials during database failures.
3. Several APIs trust caller-provided `clientId`, enabling cross-tenant access.
4. Gmail and WhatsApp webhooks are unsigned; Vobiz events have no persisted replay/idempotency ledger.
5. Integration credentials are stored as plaintext JSON.
6. Production UI paths can display mock data; calling and messaging code can report simulated success.
7. The event bus, scheduler and fallback memory are process-local and cannot provide durable automation.
8. LangGraph and a production queue/checkpointer are absent.

## Target architecture

### Bounded LangGraph graphs

Use multiple short-lived durable graphs rather than one graph that waits indefinitely:

1. `CompanyOnboardingGraph`: validate input, run five specialists in parallel, synthesize evidence, interrupt for customer confirmation, persist a confirmed profile, emit `company.profile_confirmed`.
2. `AcquisitionGraph`: load profile/ICP, search mother DB and Apollo, normalize/dedupe/enrich/score, reserve quota, persist leads, emit `leads.ready`.
3. `LeadEngagementGraph`: run eligibility and capacity gates, propose outreach, create an idempotent call command, stop, and resume only from provider events.
4. `ConversationContinuationGraph`: correlate inbound email/WhatsApp/callback, load memory, detect intent, apply policy, persist reply/action and emit the next event.
5. `MeetingGraph`: check ownership and availability, offer slots, recheck atomically, book, confirm and schedule reminders.
6. `SubscriptionProvisioningGraph`: process verified subscription events, grant entitlements, allocate/configure/validate a number and activate automation.
7. `DashboardAssistantGraph`: read-only tools by default; mutation proposals require deterministic authorization and, when necessary, customer confirmation.

### Five parallel specialist agents

The onboarding fan-out uses LangGraph `Send` with branch-local output and a deterministic reducer:

1. Business and website research
2. Lead and market intelligence
3. Outreach strategy
4. Conversation and objection strategy
5. Meeting qualification and scheduling strategy

Each returns a typed result containing claims, source references, confidence, gaps and warnings. Agents cannot write billing, call providers, message prospects or mutate CRM state. The reducer merges results; a synthesis node resolves conflicts; the policy gate authorizes typed commands.

### Durable execution contract

- PostgreSQL domain tables remain the source of truth.
- A PostgreSQL LangGraph checkpointer stores orchestration recovery state.
- A Redis-backed durable queue runs jobs with priority, schedules, leases, retry/backoff and a DLQ.
- Domain mutation and outbox event are committed in one transaction.
- Webhook inbox and consumer inbox unique constraints make redelivery harmless.
- External side effects use persisted idempotency keys and provider receipts.
- Large transcripts, recordings and payloads live in domain storage/object storage; graph state stores references.
- LLM nodes only propose structured actions. Deterministic services enforce tenancy, RBAC, DNC, consent, calling windows, plan limits, wallet reservation, provider capacity and meeting conflicts.

### Typed LangGraph state

At minimum include:

`schema_version`, `run_id`, `graph_name`, `thread_id`, `tenant_id`, `actor_id`, `correlation_id`, `causation_id`, `input_event_id`, `company_id`, `company_profile_version`, `campaign_id`, `lead_id`, `conversation_id`, `subscription_id`, `config_snapshot_id`, `policy_snapshot_id`, `current_status`, `specialist_findings`, `decision`, `proposed_actions`, `approved_action_ids`, `tool_receipts`, `pending_jobs`, `errors`, `checkpoint_seq`, `created_at`, `updated_at`.

Do not store provider secrets, complete recordings, full provider payloads or unbounded transcripts in checkpoint state.

## Configuration and hardcoding policy

“Nothing hardcoded” should mean no environment-, tenant-, plan-, provider- or campaign-specific behavior is embedded in application logic.

Allowed code constants are true invariants only: schema versions, enum identifiers, safe upper bounds and validated action allowlists.

The following must be variables or versioned persisted configuration:

- Secrets and connection details: validated server environment/secret manager references
- Provider base URLs, account identifiers and feature capability flags: environment plus provider configuration
- Prices, currency, billing intervals and entitlements: server-owned plan catalog
- Retry delays, maximum attempts, callback windows, reminder offsets and queue priorities: versioned policy tables
- Calling hours, time zones, concurrency and provider limits: platform/plan/tenant/campaign capacity policies
- Models, prompts, temperature, tool permissions and structured output schemas: versioned model/prompt profiles
- ICP weights, data-quality thresholds and lead scoring: versioned scoring models
- Email/WhatsApp templates and channel rules: versioned tenant/campaign templates and policies
- UI stats, balances, pricing and provider health: live server data only

Resolve configuration in this precedence order: platform → plan → tenant → campaign. Validate it into an immutable `ConfigSnapshot` and store the snapshot ID on every graph run.

## Data model additions

Use canonical `tenant_id` on all tenant-owned tables and add tenant-leading indexes, composite foreign keys and RLS.

Required groups:

- Identity: users, tenants, memberships, roles, sessions, OAuth accounts
- Business: companies, profile versions, research runs/evidence, ICP versions
- Acquisition: mother leads, tenant leads, sources, enrichment, scores, campaigns, campaign leads
- State/memory: lead states, state transitions, memories, suppression/DNC, callbacks
- Telephony: phone numbers, provisioning jobs, calls, attempts, events, recordings, transcripts, summaries
- Messaging: email threads/messages, WhatsApp threads/messages
- Meetings: calendar connections, booking requests, meetings, reminders
- Billing: plans, subscriptions, payments, wallets, transactions, entitlement ledger, usage reservations/records
- Runtime: graph runs, checkpoints, agent runs, tool executions, queue jobs, outbox, inbox, webhook events, DLQ
- Product/security: notifications, integration credentials, config snapshots, audit logs, feature flags

## Implementation phases and gates

### Phase 0 — Evidence and green baseline (2–3 days)

- Fix TypeScript/build errors.
- Inventory every route, schema, mock, provider method and environment dependency.
- Reconcile Drizzle schema with checked-in migrations; prove a clean database can be created.
- Add `lint`, `typecheck`, unit, integration, E2E and CI scripts.
- Add typed environment validation and forbid production mock/stub fallbacks.
- Capture UI regression screenshots before functional changes.

Gate: clean install, fresh migration, typecheck, lint and production build all pass; no mock success path is reachable in production.

### Phase 1 — Security and tenancy foundation (4–6 days)

- Remove demo identities, committed credentials and fallback signing secrets.
- Make authentication fail closed; rotate/hash sessions correctly.
- Add OAuth state/PKCE, verification/reset, CSRF/origin checks and rate limits.
- Standardize `tenant_id`; add membership-derived `AuthContext`, RBAC, RLS, FKs and indexes.
- Encrypt/vault integration credentials and add audit logs.

Gate: cross-tenant API/DB matrix passes; DB outage returns an error, never demo access; role matrix and forged-session tests pass.

### Phase 2 — Durable runtime and LangGraph skeleton (5–7 days)

- Add LangGraph JS and PostgreSQL checkpointer.
- Add durable Redis queue/workers with leases, priorities, schedules, backoff and DLQ.
- Implement event contracts, outbox/inbox, webhook ledger, graph/tool-run tables and correlation IDs.
- Implement configuration resolver/snapshot and deterministic policy executor.
- Version APIs under `/api/v1`.

Gate: kill a worker after each node, restart, redeliver events twice and observe one business effect with successful checkpoint resume.

### Phase 3 — Discovery, confirmation, ICP and three samples (5–7 days)

- Implement `CompanyOnboardingGraph` with the five-agent parallel fan-out.
- Split onboarding into submit, research status, draft, edit and confirm endpoints.
- Persist research provenance, profile versions, ICP versions and scoring models.
- Upgrade Apollo/internal lead search, normalization, dedupe, enrichment and quality scoring.
- Deliver exactly three genuine sample leads after confirmation.

Gate: no leads are generated before confirmation; sample quota cannot exceed three under concurrency; failures are visible and retryable.

### Phase 4 — Billing, entitlements and usage (5–7 days)

- Move pricing into a server-owned plan catalog.
- Implement checkout and signature-verified, idempotent payment webhooks.
- Add subscription state machine, append-only ledger and granular usage reservations/finalization.
- Make every expensive action reserve entitlement atomically.

Gate: duplicate/reordered webhooks cannot duplicate credits; frontend amounts are ignored; concurrent usage cannot overspend.

### Phase 5 — Vobiz provisioning capability spike and adapter (2 + 6–10 days)

- Inspect the actual Vobiz tool/API contract for number search, purchase, allocation, configuration, webhook/media and health checks.
- Implement supported capabilities behind a typed adapter.
- If purchase is unsupported, implement an automated pre-provisioned number pool; do not simulate purchase.
- Persist provisioning state and provider receipts.

Gate: real sandbox allocation/configuration/validation passes. Unsupported capabilities remain explicitly unavailable.

### Phase 6 — Call engine and live voice (8–12 days)

- Implement campaigns, attempts, events, suppression/calling-window checks and capacity reservations.
- Add priority call workers and signed/idempotent Vobiz webhook ingestion.
- Implement real media/voice turn-taking through supported provider interfaces.
- Remove all random and fake outcomes; finalize usage from real events.

Gate: sandbox outbound call completes end-to-end; DNC, limits, concurrency, time zone, duplicate events and provider outage tests pass.

### Phase 7 — Outcome, memory, retries and callbacks (6–9 days)

- Implement state-transition history, summaries, memories, configurable retries and durable callbacks.
- Resume graphs from provider and scheduled events.
- Atomically cancel future outreach on DNC/not-interested.

Gate: callbacks/retries survive restarts; every transition is exact-once and auditable; relative-time interpretation is timezone safe.

### Phase 8 — Omnichannel and meetings (8–12 days)

- Add verified inbound and idempotent outbound email/WhatsApp adapters.
- Persist threads, maintain Gmail threading and enforce WhatsApp template/session rules.
- Add calendar connection, free/busy, slot offering/recheck, atomic booking, confirmations and reminders.

Gate: duplicate inbound events do not duplicate replies; concurrent bookings cannot double-book; opt-out cancels all later outreach.

### Phase 9 — Recordings, transcription and analysis (5–8 days)

- Store audio in encrypted object storage with checksum and retention policy.
- Persist metadata and expose short-lived authorized playback URLs.
- Run async transcription, diarization, structured analysis, summary and memory update.

Gate: duplicate/corrupt recording events are safe; access is tenant-scoped; legal recording policy is enforced.

### Phase 10 — Live product experience (6–9 days)

- Remove every `mock-data` production fallback.
- Add SSE/WebSocket updates backed by the durable event stream.
- Complete bookings, notifications, recording player, usage, integration health and full lead history.
- Add permission-aware dashboard AI with read-only defaults and confirmation for costly/destructive actions.

Gate: zero static KPI/balance paths; stream reconnect recovers missed events; AI numbers come only from authorized live queries.

### Phase 11 — Hardening and release (7–10 days)

- Add structured logs, distributed traces, metrics, dashboards, alerts, SLOs and reconciliation jobs.
- Add circuit breakers, backups/restore, secret rotation, load/security/chaos/accessibility tests and runbooks.
- Release through staging, provider sandboxes and a capped production canary with feature/provider kill switches.

Gate: all mandatory scenarios in `plan.txt` pass; restore drill passes; no duplicate billing/message/meeting effects; no silent job loss.

## Parallel delivery strategy

After Phase 2 stabilizes event and state contracts:

- Phase 3 discovery and Phase 4 billing may run in parallel.
- Vobiz capability discovery may begin during Phase 4.
- Messaging/calendar provider work may overlap the call/retry work once shared event contracts are frozen.
- Media processing and UI/live-data work may overlap after call-event contracts stabilize.

The critical path is approximately 10–14 weeks for a small experienced team, excluding delays caused by unsupported Vobiz capabilities, provider approvals or expanded compliance requirements.

## Verification strategy

Use Vitest, React Testing Library, Playwright, Testcontainers for PostgreSQL/Redis and typed provider contract fixtures.

Required suites:

- Static: lockfile install, secret scan, env validation, migration consistency, typecheck, lint and production build
- Unit: normalization, scoring, transitions, DNC/consent, calling windows, entitlements, retry calculation, capacity, signatures, RBAC and graph routing
- Database/integration: fresh and upgrade migrations, RLS, tenant isolation, uniqueness, ledgers, locks/leases, queue recovery and object-storage authorization
- API: auth, RBAC, tenant scope, schemas, rate limits, CSRF, idempotency and realtime authorization/reconnect
- Provider contracts: Apollo, Vobiz, WhatsApp, Gmail, calendar, payments and LLM structured output
- LangGraph durability: checkpoint/resume at every node, duplicate delivery, side-effect/checkpoint split failures, interrupts, version migration, deterministic parallel reduction, poison-state DLQ and replay safety
- E2E: the complete signup-to-meeting flow plus all mandatory scenarios in `plan.txt`
- Release: worker-kill, duplicate-webhook storm, load/concurrency, security, backup/restore and canary rollback

## Definition of done

A feature is complete only when its live tenant-scoped UI, API, database migration, background execution, provider contract, policy enforcement, idempotency, checkpoint/restart behavior, error/retry/DLQ state, logs/metrics/traces, security controls, tests, deployment and rollback documentation all pass.

No feature is complete while it depends on mock data, randomized provider outcomes, fake success, hardcoded tenant/business values, insecure default secrets or unverified provider capability.
