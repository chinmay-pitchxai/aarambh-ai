# AarambhAI — Production Upgrade Plan

## Current State Audit

### What Exists (80% Complete)

| Component | Status | Details |
|-----------|--------|---------|
| **Agent Pipeline** | EXISTS | 14 AI agents with typed protocols, message bus, context store |
| **Pipeline Orchestrator** | EXISTS | Scout → Ranker → Consent → Dialer → Outcome Router → Nudge |
| **Vobiz Telephony** | EXISTS | Outbound calling via Vobiz API |
| **WhatsApp Integration** | EXISTS | Business API for follow-ups and reminders |
| **Gmail Integration** | EXISTS | Composio OAuth for email follow-ups |
| **Gemini LLM** | EXISTS | 2.5 Flash for transcript analysis, BANT extraction, pitch generation |
| **PostgreSQL Schema** | EXISTS | 11 tables covering full lead lifecycle |
| **Redis** | EXISTS | Context store, cache, conversation memory |
| **Retry System** | EXISTS | DB-backed retry queue with escalating delays (24h, 32h, 48h) |
| **Reminder Agent** | EXISTS | Day-before and day-of WhatsApp reminders |
| **Booking Confirmer** | EXISTS | AI calls lead to confirm meeting |
| **Dashboard** | EXISTS | Pipeline funnel, KPIs, cost tracking, band distribution |
| **Leads Board** | EXISTS | Kanban-style lead management |
| **Lead Detail** | EXISTS | Talking points, conversation timeline, BANT display |
| **Activity Feed** | EXISTS | Chronological event timeline |
| **Landing Pages** | EXISTS | Home, features, pricing, about pages |
| **Custom Charts** | EXISTS | SVG-based line, bar, pie, heatmap charts |
| **Seed Data** | EXISTS | 20 test leads across all pipeline stages |

### What's Missing (20% to Build)

| Component | Status | Priority |
|-----------|--------|----------|
| **Authentication** | MISSING | CRITICAL |
| **Multi-tenancy** | MISSING | CRITICAL |
| **Middleware** | MISSING | CRITICAL |
| **User Management** | MISSING | CRITICAL |
| **Razorpay Payments** | MISSING | HIGH |
| **Apollo Integration** | STUB ONLY | HIGH |
| **Recordings/Storage** | MISSING | HIGH |
| **Transcription UI** | MISSING | MEDIUM |
| **RBAC** | MISSING | MEDIUM |
| **Audit Logging** | MISSING | MEDIUM |
| **Rate Limiting** | MISSING | MEDIUM |
| **Structured Logging** | MISSING | MEDIUM |
| **Tests** | MISSING | MEDIUM |

---

## Implementation Phases

### Phase 1 — Foundation (Auth + Multi-tenancy)

**Duration:** 3-4 days

**Database Changes:**
```sql
-- New tables
users (id, email, password_hash, name, avatar_url, email_verified, created_at)
accounts (id, user_id, provider, provider_account_id, refresh_token, access_token, expires_at)
sessions (id, user_id, session_token, expires_at)
organizations (id, name, slug, logo_url, created_at)
organization_members (id, org_id, user_id, role, created_at)
business_profiles (id, org_id, company_name, location, industry, website, description, icp_data, onboarding_completed)
```

**Backend:**
- NextAuth.js setup with email/password + Google OAuth
- Argon2id password hashing
- Session management with HTTP-only cookies
- Middleware for route protection
- Tenant isolation middleware (every query scoped by orgId)

**Frontend:**
- Login page (`/login`)
- Signup page (`/signup`)
- Google OAuth button
- Protected route wrapper
- Onboarding modal (first login)

**Files to Create/Modify:**
```
src/app/api/auth/[...nextauth]/route.ts
src/app/(auth)/login/page.tsx
src/app/(auth)/signup/page.tsx
src/lib/auth.ts
src/lib/middleware.ts
middleware.ts (root)
src/backend/db/schema.ts (extend)
```

---

### Phase 2 — Onboarding + ICP + Apollo

**Duration:** 3-4 days

**Database Changes:**
```sql
icp_profiles (id, org_id, version, industries, job_titles, seniority, company_size_min, company_size_max, locations, keywords, technology_used, excluded_industries, excluded_titles, created_at)
lead_generation_usage (id, org_id, free_leads_used, paid_leads_purchased, last_generated_at)
```

**Backend:**
- Business Profiler Agent (web research via Gemini)
- ICP Generator Agent (auto-generate from business profile)
- Apollo Lead Service (real API integration)
- Lead normalization and deduplication
- Free trial enforcement (3 leads max)
- Usage tracking

**Frontend:**
- Onboarding wizard (Company Name → Location → Business Type → Research → ICP → Leads)
- ICP display/edit page (`/leads/icp`)
- Lead generation UI with trial status
- Upgrade prompt when quota exhausted

**Files to Create/Modify:**
```
src/backend/agents/business-profiler.ts
src/backend/agents/icp-generator.ts
src/backend/services/apollo.ts
src/app/(app)/onboarding/page.tsx
src/app/(app)/leads/icp/page.tsx
src/app/api/leads/generate/route.ts
src/app/api/icp/route.ts
src/app/api/onboarding/route.ts
```

---

### Phase 3 — Razorpay Payments

**Duration:** 2-3 days

**Database Changes:**
```sql
plans (id, name, price, currency, interval, lead_credits, features, active)
subscriptions (id, org_id, plan_id, status, razorpay_subscription_id, started_at, expires_at)
payments (id, org_id, razorpay_order_id, razorpay_payment_id, amount, currency, status, signature_verified)
usage_entitlements (id, org_id, lead_credits_remaining, call_minutes_remaining, expires_at)
```

**Backend:**
- Razorpay order creation (`/api/payments/create-order`)
- Payment verification (`/api/payments/verify`)
- Webhook handler (`/api/webhooks/razorpay`)
- Subscription management
- Entitlement checking before lead generation

**Frontend:**
- Pricing page (integrate with existing `/landing-page/pricing`)
- Checkout flow
- Payment success/failure pages
- Subscription management

**Files to Create/Modify:**
```
src/app/api/payments/create-order/route.ts
src/app/api/payments/verify/route.ts
src/app/api/webhooks/razorpay/route.ts
src/app/api/subscription/route.ts
src/lib/razorpay.ts
```

---

### Phase 4 — Recordings + Transcripts

**Duration:** 3-4 days

**Database Changes:**
```sql
recordings (id, org_id, lead_id, call_id, provider_recording_id, storage_key, duration_ms, waveform_peaks, status)
transcripts (id, org_id, call_id, language, status, full_text, quality_score)
transcript_segments (id, transcript_id, speaker, start_ms, end_ms, text, confidence, sequence)
callbacks (id, org_id, lead_id, source_call_id, reason, scheduled_at, timezone, status)
```

**Backend:**
- Recording ingestion from Vobiz webhooks
- S3/R2 storage for audio files
- Waveform peak generation
- Transcription pipeline (Gemini or Whisper)
- Speaker separation
- Storage abstraction layer

**Frontend:**
- Audio player component (play, pause, seek, speed, download)
- Waveform visualization
- Transcript viewer (two-party conversation layout)
- Call detail page upgrade

**Files to Create/Modify:**
```
src/backend/services/storage.ts
src/backend/services/transcription.ts
src/app/api/webhooks/vobiz/recording/route.ts
src/components/AudioPlayer.tsx
src/components/Waveform.tsx
src/components/TranscriptViewer.tsx
src/app/(app)/leads/[id]/calls/[callId]/page.tsx
```

---

### Phase 5 — Hardening + Tests

**Duration:** 3-4 days

**Security:**
- RBAC (owner, admin, member, viewer)
- Rate limiting on API routes
- Webhook signature verification (Razorpay, Vobiz, WhatsApp)
- CSRF protection
- Input validation with Zod
- Audit logging

**Observability:**
- Structured logging (pino or similar)
- Health endpoints (`/api/health`)
- Correlation IDs
- Error tracking

**Testing:**
- Unit tests for agents
- Integration tests for API routes
- E2E test for full user flow
- Payment webhook idempotency tests

**DevOps:**
- Dockerfile
- docker-compose.yml
- CI/CD pipeline (GitHub Actions)
- Environment validation on startup

---

## Environment Variables Required

```env
# DATABASE
DATABASE_URL=

# REDIS
REDIS_URL=

# APPLICATION
NEXT_PUBLIC_APP_URL=
APP_SECRET=

# AUTH
NEXTAUTH_SECRET=
NEXTAUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# AI
GEMINI_API_KEY=

# LEAD SOURCING
APOLLO_API_KEY=

# TELEPHONY
VOBIZ_API_KEY=
VOBIZ_API_SECRET=
VOBIZ_PHONE_NUMBER=
VOBIZ_WEBHOOK_SECRET=

# PAYMENTS
NEXT_PUBLIC_RAZORPAY_KEY_ID=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# MESSAGING
WHATSAPP_API_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_WEBHOOK_SECRET=

# EMAIL
COMPOSIO_API_KEY=

# STORAGE
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET_KEY=

# SECURITY
ENCRYPTION_KEY=
```

---

## Database Migration Commands

```bash
# Generate migrations
npm run db:generate

# Push to database
npm run db:push

# Or run migrations
npm run db:migrate
```

---

## Key Architectural Decisions

1. **Multi-tenancy:** Row-level isolation with `orgId` on all business tables
2. **Auth:** NextAuth.js with JWT sessions + HTTP-only cookies
3. **Payments:** Razorpay with webhook-first verification (never trust frontend)
4. **Storage:** S3-compatible object storage for recordings (not PostgreSQL)
5. **Queue:** Redis-backed job queue for async work (recordings, transcription, callbacks)
6. **LLM:** Gemini 2.5 Flash for all AI operations
7. **Telephony:** Vobiz for outbound + inbound calls
8. **Schema:** Drizzle ORM with proper migrations

---

## Acceptance Criteria

### Authentication
- [ ] New customer can create account
- [ ] Password confirmation works
- [ ] Password is securely hashed (Argon2id)
- [ ] Existing user can login
- [ ] Google authentication works
- [ ] Logout works
- [ ] Protected pages are protected

### Onboarding
- [ ] First user sees onboarding
- [ ] Company name can be entered
- [ ] Location can be entered
- [ ] Category can be selected
- [ ] Business research runs
- [ ] ICP is generated
- [ ] Skip flow works

### Apollo
- [ ] Exactly 3 free unique leads delivered
- [ ] Usage is tracked
- [ ] Fourth lead blocked
- [ ] Duplicate leads handled

### Razorpay
- [ ] Payment order server-created
- [ ] Checkout works
- [ ] Signature verification works
- [ ] Webhook verification works
- [ ] Duplicate webhook handled

### Calls
- [ ] Real outbound call initiated
- [ ] Incoming call processed
- [ ] Recording attached
- [ ] Audio plays with waveform
- [ ] Transcript works with speakers

### Production
- [ ] `npm run build` succeeds
- [ ] No hardcoded API secrets
- [ ] No fake production outcomes
- [ ] Tenant isolation enforced
- [ ] Webhooks idempotent
- [ ] Errors logged
