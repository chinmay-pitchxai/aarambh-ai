# AarambhAI — AI Cold Call Pipeline

## Folder Structure

```
src/
├── app/                        ← FRONTEND (Next.js App Router)
│   ├── layout.tsx              ← Root layout + Sidebar
│   ├── page.tsx                ← Redirects to /dashboard
│   ├── globals.css             ← Dark theme, glow cards, badges
│   ├── dashboard/page.tsx      ← Pipeline stats, KPIs, spend
│   ├── leads/page.tsx          ← Filterable leads table
│   ├── leads/[id]/page.tsx     ← Lead detail: calls, messages, BANT
│   ├── activity/page.tsx       ← Real-time activity timeline
│   └── api/                    ← API ROUTES (backend endpoints)
│       ├── stats/route.ts      ← GET pipeline stats
│       ├── leads/route.ts      ← GET leads with filters
│       ├── leads/[id]/route.ts ← GET lead detail
│       ├── activity/route.ts   ← GET activity feed
│       └── run/route.ts        ← POST trigger pipeline
│
├── components/                 ← UI COMPONENTS
│   └── Sidebar.tsx             ← Navigation sidebar
│
└── backend/                    ← BACKEND (agents, DB, integrations)
    ├── db/
    │   ├── schema.ts           ← Drizzle ORM schema (8 tables)
    │   └── index.ts            ← PostgreSQL connection
    └── agents/
        ├── types.ts            ← Agent, MessageBus, ContextStore interfaces
        ├── bus.ts              ← In-memory pub/sub message bus
        ├── context.ts          ← Redis store + RLM memory recall
        ├── pipeline.ts         ← Orchestrator: Consent→Dial→Nudge
        ├── scout.ts            ← Mother DB reuse + Apollo pull
        ├── ranker.ts           ← 1-100 scoring, Hot/Warm/Cold
        ├── consent.ts          ← DNC + opt-in gate
        ├── llm-lab.ts          ← Gemini: transcript, BANT, pitch
        ├── dialer.ts           ← Vobiz dial + 5 outcomes
        ├── nudge.ts            ← WhatsApp + Gmail follow-up
        └── index.ts            ← Barrel export
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL + Redis (or use Docker)
docker run -d --name pg -e POSTGRES_PASSWORD=pass -p 5432:5432 postgres:16
docker run -d --name redis -p 6379:6379 redis:7

# 3. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 4. Push database schema
npx drizzle-kit push

# 5. Start dev server
npm run dev
# → http://localhost:3000
```

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/run` | Trigger full pipeline for a client |
| GET | `/api/stats` | Pipeline stats, bands, today's KPI |
| GET | `/api/leads` | Paginated leads with filters |
| GET | `/api/leads/[id]` | Lead detail + call history + messages |
| GET | `/api/activity` | Merged call/message timeline |

### Example: Run Pipeline

```bash
curl -X POST http://localhost:3000/api/run \
  -H "Content-Type: application/json" \
  -d '{"clientId": "demo", "icpTags": ["vp-sales", "saas", "bangalore"], "batchSize": 10}'
```
