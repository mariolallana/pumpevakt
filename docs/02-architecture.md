# 02 · Architecture (lean v2)

## 1. Principles
1. **One deployable.** A single Cloudflare Worker handles cron jobs, the Telegram webhook and (later) a JSON API for the dashboard.
2. **One database.** Cloudflare D1 (SQLite). About 160 stations and a few thousand rows a year don't need Postgres or PostGIS. Radius search is a haversine in TypeScript over 160 rows.
3. **One copy of the logic.** All maths lives in `src/core/` as pure TypeScript and is unit-tested. SQL only stores and reads.
4. **Heavy lifting outside the Worker.** Big one-off jobs (the station import, backups) run in GitHub Actions, which keeps the Worker within its free CPU budget.
5. **Nothing on my PC.** Cloudflare and GitHub run everything.

## 2. Diagram

```
        Telegram app (phone)                       Later: browser (Phase 4)
              │  ▲                                        │
     webhook  │  │ sendMessage                            │ GET /api/*
              ▼  │                                        ▼
 ┌──────────────────── Cloudflare Worker  "pumpevakt" ─────────────────────┐
 │ fetch()      /telegram  → bot commands (/status /near /p /mute …)       │
 │              /api/*     → read-only JSON for the dashboard (Phase 4)    │
 │              /health    → last successful run per job                   │
 │ scheduled()  06:30 & 17:30 UTC → market job: FRED + Norges Bank +       │
 │                                   OpenVan → WDI → market alarm          │
 │              every 12 h        → station-price job: adapters → prices   │
 │                                   → outlier alarm (gated)               │
 │ src/core/  (pure TS: wdi, signals, geo, netSaving, format) ← Vitest     │
 └───────────────┬─────────────────────────────────────────────────────────┘
                 │ D1 binding
                 ▼
     Cloudflare D1 (SQLite): stations · prices · market_daily · alerts · runs

 GitHub (mariolallana/pumpevakt)
   ci.yml      : typecheck + vitest on every PR
   deploy.yml  : wrangler deploy + d1 migrations on push to main
   weekly.yml  : refresh stations from Drivstoffpriser ODbL → D1 · d1 export backup · /health check
```

## 3. Why this stack (challenge 6 and 7 in [10](10-design-review.md))

| Need | Choice | Rejected and why |
|---|---|---|
| Scheduler | Worker **Cron Triggers** | Supabase pg_cron → pg_net → Edge Function: three hops, hard to debug, and the project pauses after 7 idle days. GitHub Actions cron: delayed or skipped under load |
| Webhook (Telegram) | Same Worker | A second service |
| DB | **D1** | Supabase Postgres + PostGIS: overkill for 160 rows |
| Web (Phase 4) | **Vite + React SPA** on Cloudflare Pages | Next.js: no server rendering needed, since all data is a tiny JSON API |
| Language | TypeScript everywhere | — |

## 4. Flows

**Market job** (twice daily):
1. Fetch the last 60 days of ULSD and Brent (FRED CSV), USD/NOK (Norges Bank) and the national average (OpenVan).
2. Upsert into `market_daily(day, series, value)`. Compute `wdi` for each day that has both inputs.
3. `core/signals.ts` evaluates the market rule ([04](04-alert-engine.md)) → insert into `alerts` (with a `dedupe_key`). Shadow mode marks it as not sent.
4. Send via Telegram. Write a `runs` row. On failure, retry once in the next cron; two consecutive failures trigger a Telegram "⚠️ data job failing" message.

**Station-price job** (every 12 h; every 30 min once a live source is unlocked): run the enabled adapters (`drivstoffpriser`, later `google_places` or `partner`), insert only *changed* prices, then evaluate the outlier rule (gated).

**Bot command:** Telegram → `POST /telegram` (verifies the secret header and the chat allowlist) → handler → reply.

## 5. Free-tier budget (verify at setup — limits change)

| Service | Free limit (as known 2026) | Expected use |
|---|---|---|
| Workers | 100k requests/day, **10 ms CPU per invocation**, 5 cron triggers | < 200 requests/day. Jobs are network-bound (fetch time doesn't count as CPU) |
| D1 | 5 GB, 5M rows read/day, 100k rows written/day | < 5 MB/yr, < 1k writes/day |
| GitHub Actions | 2,000 min/month (private repo) | ~60 min/month |
| Telegram Bot API | Free | — |
| FRED / Norges Bank / SSB / OpenVan | Free, keyless | ~6 requests/day |
| Optional AI photo extraction (later) | Claude Haiku 5.5 at cents/month, or Gemini Flash free tier | — |

**CPU risk:** parsing the 420 KB station file can come close to 10 ms, which is why that import runs in GitHub Actions, not the Worker. If a job ever hits the limit, move it to the weekly Action or to the Workers paid plan ($5/month).

## 6. Repo layout

```
pumpevakt/
├─ CLAUDE.md · README.md · docs/
├─ scripts/            probe-sources.mjs · backtest-wholesale.mjs · probe-google-places.mjs · import-stations.mjs
├─ db/schema.sql       (D1 migrations live in db/migrations/)
├─ src/
│  ├─ index.ts         fetch() + scheduled() entry
│  ├─ config.ts        single-user settings (typed, read from env vars)
│  ├─ core/            wdi.ts · signals.ts · geo.ts · netSaving.ts · format.ts   ← pure, tested
│  ├─ sources/         fred.ts · norgesBank.ts · openvan.ts · drivstoffpriser.ts · (googlePlaces.ts)
│  ├─ bot/             commands.ts · telegram.ts
│  └─ db.ts            typed D1 queries
├─ test/               core/*.test.ts + fixtures/
├─ web/                (Phase 4) Vite + React dashboard
├─ wrangler.toml
└─ .github/workflows/  ci.yml · deploy.yml · weekly.yml
```
