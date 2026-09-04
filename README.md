# AarambhAI — AI Cold Call Pipeline

B2B AI sales platform. Automated outbound calls (Vobiz + Gemini Live voice), WhatsApp & Gmail conversations, meeting booking (Composio Google Calendar), all powered by LangGraph agents.

## Prerequisites

- Node.js **18.17+** (or 20+)
- Docker Desktop (for Postgres + Redis)
- npm

## Quick Start (10 minutes)

### 1. Clone & install

```bash
git clone https://github.com/chinmay-pitchxai/aarambh-ai.git
cd aarambh-ai
npm install
```

### 2. Start Postgres + Redis (Docker)

```bash
docker compose up -d
# or, without compose:
# docker run -d --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=aarambhai -p 5432:5432 postgres:16
# docker run -d --name redis -p 6379:6379 redis:7
```

### 3. Environment setup

```bash
cp .env.example .env
```

Then edit `.env` and fill in the keys (at minimum the required ones below):

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `DATABASE_URL` | ✓ | `postgresql://postgres:postgres@localhost:5432/aarambhai` |
| `REDIS_URL` | ✓ | `redis://localhost:6379` |
| `APP_SECRET` | ✓ | Any 32+ char random string (`openssl rand -hex 32`) |
| `NEXT_PUBLIC_APP_URL` | ✓ | `http://localhost:3000` |
| `GEMINI_API_KEY` | ✓ | https://aistudio.google.com/apikey |
| `GOOGLE_CLIENT_ID` / `SECRET` | for Google login | https://console.cloud.google.com/apis/credentials |
| `APOLLO_API_KEY` | for lead search | https://app.apollo.io |
| `COMPOSIO_API_KEY` | for Calendar | https://app.composio.dev |
| `VOBIZ_AUTH_ID` / `VOBIZ_AUTH_TOKEN` | for calls | https://console.vobiz.ai |

You can start the app without the integration keys — those integrations will just show as disconnected in the Connections page.

### 4. Push the database schema

```bash
npx drizzle-kit push
```

Then apply tenant isolation (RLS) policies:

```bash
npm run db:setup
```

This creates all tables and enables per-workspace row-level security.

### 5. Seed optional demo data

```bash
npm run seed:fresh
```

### 6. Start the dev server

```bash
npm run dev
```

Open **http://localhost:3000** — the login page appears. Create an account (or sign in with Google).

### 7. Onboarding

After login, the business setup modal appears. Enter:

- **Business name** (required)
- **Business type** (required)
- **Website** OR **Location** (at least one required — the AI researches your business from it)

The platform then:
1. Researches your business (or fallback: location search)
2. Generates an ICP (Ideal Customer Profile) via Gemini
3. Searches Apollo for matching decision-makers
4. Imports leads into your pipeline
5. Queues initial calls

## Connections

Go to **Connections** in the sidebar to wire integrations:

### Vobiz (calling)
1. Click **Connect** on the Vobiz tile
2. Enter your **Auth ID** and **Auth Token** from https://console.vobiz.ai
3. Pick a number from your Vobiz account (or let it auto-select the single one)
4. All outbound calls + the AI voice agent now use that number

### Google Calendar (meetings)
1. Click **Connect** on Google Calendar
2. It auto-creates the Composio auth config, then sends you through Google OAuth
3. After booking, meetings appear in Google Calendar with **Google Meet** links

### Email & WhatsApp
- **WhatsApp**: connect via the Meta/Composio tile
- **Gmail**: connect via the Gmail tile
- Inbound replies are read by the conversational AI and answered like a human

## The Full Workflow

```
Lead import (Apollo/onboarding) → saved to DB → call-init queue
        → Vobiz outbound call → Gemini Live voice agent (Indian voice, natural conversation)
        → outcome router:
              • interested  → WhatsApp info + Gmail + schedule callback (5 min)
              • meeting     → check calendar → book slot → send Google Meet link
              • not_interested → mark lost
              • no_answer   → retry up to 3 attempts (24h / 32h)
        → lead replies on WhatsApp/Email → conversational AI answers like a human
        → booking confirmed → WhatsApp confirmation with Meet link
```

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (http://localhost:3000) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm test` | Run the test suite (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run db:push` | Push schema to DB |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run scheduler` | Start the background scheduler (retries, reminders, callbacks) |
| `npm run seed:fresh` | Seed demo data |

> **Note:** The `scheduler` handles periodic tasks (retry calls, meeting reminders, due callbacks). Run it in a separate terminal alongside `npm run dev` for fully automatic behaviour.

## Production Notes

- Never commit real `.env` — keep only `.env.example`
- Set all webhook secrets in production
- The webhook URLs are:
  - Vobiz: `{APP_URL}/api/v1/webhooks/vobiz`
  - WhatsApp: `{APP_URL}/api/webhooks/whatsapp`
  - Gmail: `{APP_URL}/api/webhooks/gmail`
- Run `npm run guard:production` before shipping

## Troubleshooting

- **`DATABASE_URL not set`**: copy `.env.example` → `.env` and set `DATABASE_URL`
- **Docker port conflict**: `docker compose down` then `docker compose up -d`
- **Tables missing**: run `npx drizzle-kit push`
- **Tracker shows everything disconnected**: complete the Connections page steps above