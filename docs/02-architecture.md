# 02 · Architecture (lean v3)

## 1. Principles
1. **One deployable.** A single Cloudflare Worker handles cron jobs, the Telegram webhook and (Phase 4) a read-only JSON API.
2. **One database.** Cloudflare D1 (SQLite). ~160 stations and some tens of thousands of rows a year. Radius search is a haversine in TypeScript.
3. **One copy of the logic.** `src/core/` is pure, tested TypeScript. SQL only stores and reads.
4. **Open, keyless sources only** ([01](01-data-sources.md)).
5. **Nothing on my PC.** Cloudflare and GitHub run everything.

## 2. Diagram

```
        Telegram (phone)                                 Phase 4: browser
            │  ▲                                                │
   webhook  │  │ sendMessage                                    │ GET /api/*
            ▼  │                                                ▼
 ┌──────────────────── Cloudflare Worker "pumpevakt" ──────────────────────┐
 │ fetch()     /telegram → /near /status /mute /shadow /health, callbacks   │
 │             /api/*    → read-only JSON (Phase 4) · /health              │
 │ scheduled() */30 min  → prices job: drivstoffapp.no (3 calls) → upsert   │
 │                         stations · insert changed prices · Oslo median   │
 │                         → market-drop + cheap-station rules → Telegram   │
 │             06:30 UTC → market job: FRED + Norges Bank → WDI (context)   │
 │ src/core/ (pure: signals, geo, netSaving, wdi, format) ← Vitest          │
 └──────────────┬──────────────────────────────────────────────────────────┘
                ▼ D1 binding
     D1 (SQLite): stations · prices · market_daily · alerts · runs · settings

 GitHub: ci.yml (typecheck + test) · deploy.yml (migrations + wrangler deploy)
         weekly.yml (D1 export backup + external /health check)
```

## 3. Why this stack ([10](10-design-review.md) challenges 6–7)

| Need | Choice | Rejected |
|---|---|---|
| Scheduler + webhook | Worker cron triggers + fetch handler in one file | Supabase pg_cron → pg_net → Edge Function (3 hops, pauses after 7 idle days). GitHub Actions cron (delayed or skipped runs) |
| DB | D1 | Postgres + PostGIS (overkill) |
| Station master data | Upserted from the price API response itself | A separate import job (one less moving part) |
| Phase 4 web | Vite + React on Cloudflare Pages | Next.js (no server rendering needed) |

## 4. Prices job (every 30 min)
1. Call `GET /stations/fuel/nearby` for 3 centres (radius 12 km, `limit=100`, `include_no_price=false`), with a 15 s timeout each. Dedupe by `id`.
2. Upsert `stations`. For each fuel, insert into `prices` only if the price or `observed_at` changed.
3. Compute the Oslo level `L` (median of fresh diesel prices) and update today's `oslo_diesel_median` in `market_daily`.
4. Run `signals.ts` (market drop, cheap station) → `alerts` (dedupe key, shadow flag) → send through Telegram according to the delivery rules.
5. Write a `runs` row. Two consecutive failures → Telegram ⚠️.

## 5. Free-tier budget (verify at setup — limits change)

| Service | Free limit (as known 2026) | Use |
|---|---|---|
| Workers | 100k requests/day, **10 ms CPU per invocation**, 5 cron triggers | ~50 cron runs + bot requests/day |
| D1 | 5 GB, 5M reads/day, 100k writes/day | < 50 MB/yr, < 2k writes/day |
| GitHub Actions | 2,000 min/month (private repo) | ~40 min/month |
| drivstoffapp.no, FRED, Norges Bank | Free and keyless | ~150 + 2 requests/day |

**CPU risk:** each run parses ~3 × 100 KB of JSON (the responses include nested `expand` data). That should fit within 10 ms CPU, but the first deploy must check this with `wrangler tail`. If it doesn't fit, use the Workers paid plan ($5/month) or drop to 2 calls per run.

## 6. Repo layout
```
pumpevakt/
├─ CLAUDE.md · README.md · docs/ · db/schema.sql · db/migrations/
├─ scripts/  probe-sources.mjs · backtest-wholesale.mjs
├─ src/
│  ├─ index.ts        fetch() + scheduled()
│  ├─ config.ts       single-user settings from env vars
│  ├─ core/           signals.ts · geo.ts · netSaving.ts · wdi.ts · format.ts
│  ├─ sources/        drivstoffapp.ts · fred.ts · norgesBank.ts
│  ├─ bot/            commands.ts · telegram.ts
│  └─ db.ts
├─ test/             core/*.test.ts · sources/*.test.ts · fixtures/
├─ web/              (Phase 4) Vite + React dashboard
├─ wrangler.toml
└─ .github/workflows/ ci.yml · deploy.yml · weekly.yml
```
