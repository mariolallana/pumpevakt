# 02 · Architecture

## 1. Principles

1. **Zero servers to babysit.** Managed free tiers only. Nothing runs on my PC.
2. **One backend platform.** Supabase handles DB, auth, scheduled jobs and functions, which keeps the moving parts to a minimum.
3. **Source-agnostic core.** Adapters at the edge, normalised data inside ([01](01-data-sources.md)).
4. **Store changes, not polls.** Write an append-only row only when a price *changes*. This keeps the DB tiny.
5. **The database does the maths.** PostGIS for radius queries, SQL views for statistics. Edge functions stay thin.

## 2. System diagram

```
                         ┌───────────────────────────────────────────────┐
  Phone / laptop  ─────► │  Vercel (Hobby)                                │
  (installable PWA)      │  Next.js 15 app · Tailwind · shadcn/ui         │
                         │  MapLibre GL + OpenFreeMap tiles               │
                         └──────────────┬────────────────────────────────┘
                                        │ supabase-js (anon key + RLS)
                                        ▼
 ┌──────────────────────────────── Supabase (Free) ───────────────────────────────┐
 │                                                                                 │
 │  Postgres 15 + PostGIS                     Edge Functions (Deno/TS)             │
 │  ├─ stations, prices (append-only)   ◄──── ingest      ◄── pg_cron  */20 min    │
 │  ├─ price_current (view/table)             │  ├─ adapters/partner|chain|mock    │
 │  ├─ area_stats_15m, area_baseline          │  ├─ normalise + dedupe + upsert    │
 │  ├─ alert_rules, alert_events              │  └─ calls evaluate_alerts()        │
 │  └─ profiles, saved_places, channels       notify      ◄── on new alert_events  │
 │                                            │  ├─ Telegram Bot API              │
 │  RPC: stations_near(), area_trend() …      │  └─ Resend (email)                │
 │  Auth: magic link (email)                  telegram-webhook (bot commands,     │
 │  pg_cron: ingest · stats · retention       │   crowd price photos → AI extract) │
 └─────────────────────────────────────────────────────────────────────────────────┘
                                        ▲
 GitHub (repo mariolallana/pumpevakt)  │
 ├─ Actions: CI (lint, typecheck, tests) on PR
 ├─ Actions: deploy edge functions + migrations on push to main
 ├─ Actions: daily health check → Telegram if ingest stale > 2 h
 └─ Actions: weekly pg_dump backup → private release artifact
```

## 3. Components

| Component | Tech | Responsibility |
|---|---|---|
| **Web app** | Next.js 15 (App Router, RSC), TypeScript, Tailwind v4, shadcn/ui, MapLibre GL JS, TanStack Query, Recharts | UI, geolocation (client-side), PWA install, Web Push subscription |
| **DB** | Supabase Postgres + PostGIS | Source of truth, spatial queries, stats views, RLS |
| **ingest** fn | Supabase Edge Function | Run adapters → upsert stations → insert changed prices → refresh stats → `evaluate_alerts()` |
| **notify** fn | Edge Function | Drain pending `alert_events`, render templates, send via Telegram or Resend, mark delivered, retry with backoff |
| **telegram-webhook** fn | Edge Function | `/start` linking, `/near`, `/cheapest`, `/mute 6h`, photo price reports, 👍/👎 feedback callbacks |
| **Scheduler** | `pg_cron` + `pg_net` | Calls `ingest` every 20 min and `notify` every 2 min. Nightly retention and stats jobs |
| **CI/CD and watchdog** | GitHub Actions | Tests, deploys, health check, backups |

### Why not…?
- **Firebase**: no PostGIS or SQL views. Statistics would be painful.
- **A Vercel cron as scheduler**: the Hobby plan limits cron frequency (daily). pg_cron has no such limit and lives next to the data.
- **GitHub Actions as main scheduler**: 20-min schedules are delayed or skipped under load, and private repos only get 2,000 min/month. Fine for the daily watchdog, not for ingestion.
- **A native app**: a PWA plus Telegram covers push on both iOS and Android with no app store.

## 4. Key flows

**A. Ingest (every 20 min)**
1. `pg_cron` → `net.http_post(ingest)` with a service secret header.
2. `ingest` runs the enabled adapters in parallel (per-adapter timeout 20 s). A failing adapter is logged to `ingest_runs` and doesn't block the others.
3. For each observation: resolve `station_id` (via `station_source_ids`, else geo-match, else create). If the price differs from `price_current` → insert into `prices`. Otherwise just bump `price_current.last_seen_at`.
4. Call `refresh_area_stats()` and then `evaluate_alerts(run_id)`. Both are SQL, see [04](04-alert-engine.md).

**B. Find the best deal (client)**
1. The browser gets GPS (or a saved place) and calls RPC `stations_near(lat, lon, radius_km, fuel)`.
2. The DB returns stations with price, age, distance and `net_saving_nok`, computed with the user's tank size and consumption ([04 §4](04-alert-engine.md#4-net-saving-ranking)).
3. Map and list render. Prices refresh with TanStack Query every 5 min while visible.

**C. Alert**
1. `evaluate_alerts` inserts `alert_events` (idempotent unique key).
2. `notify` (pg_cron every 2 min) sends via each enabled channel in the user's settings, honouring quiet hours (deferred, not dropped).

## 5. Free-tier budget (verify limits at setup — they change)

| Service | Free limit (as known 2026) | Our expected use | Headroom |
|---|---|---|---|
| Supabase DB | 500 MB | ~40 MB/yr (≈1k price changes/day × ~100 B, plus indexes) | >10× |
| Supabase Edge Functions | 500k invocations/mo | ingest 2.2k + notify 22k + webhook ~1k ≈ 25k | 20× |
| Supabase inactivity pause | Pauses after 7 days with no activity | pg_cron and API traffic keep it active. The watchdog alerts if paused | ✔ |
| Vercel Hobby | Personal, non-commercial | 1 user | ✔ (move to Cloudflare Pages if this ever goes commercial) |
| Resend | 3,000 emails/mo, 100/day | <100/mo | 30× |
| Telegram Bot API | Free | <500 msgs/mo | ✔ |
| OpenFreeMap tiles | Free, no key | personal | ✔ (attribution required) |
| GitHub Actions | 2,000 min/mo (private repo) | CI ~200 + watchdog 30 + backup 10 | 8× |
| AI for photo price extraction (v1) | Gemini Flash free tier, or Claude Haiku (pay per use, cents) | <100 photos/mo | ✔ |

## 6. Environments

- `local`: `supabase start` (Docker) plus `next dev`, mock adapter only.
- `prod`: one Supabase project and one Vercel project. No staging; preview deployments on Vercel PRs point at prod read-only data. Enough for a personal app.

## 7. Repo layout (target)

```
pumpevakt/
├─ CLAUDE.md
├─ docs/                      # these specs
├─ apps/web/                  # Next.js PWA
│  ├─ app/(map)/page.tsx      # home: map + list
│  ├─ app/station/[id]/       # detail
│  ├─ app/trends/             # Oslo trend
│  ├─ app/alerts/  app/settings/
│  ├─ components/ ui/ (shadcn) map/ charts/
│  └─ lib/ supabase.ts geo.ts format.ts
├─ supabase/
│  ├─ migrations/0001_init.sql …
│  ├─ functions/ingest/  notify/  telegram-webhook/
│  │   └─ _shared/adapters/{mock,partner,chain,crowd,ssb}.ts
│  └─ seed/oslo_stations_osm.sql
├─ packages/core/             # pure TS: types, alert maths, net-saving (unit-tested, shared)
└─ .github/workflows/ ci.yml deploy.yml watchdog.yml backup.yml
```

pnpm workspaces. Keep `packages/core` free of I/O so the alert maths can be tested with Vitest against fixtures.
