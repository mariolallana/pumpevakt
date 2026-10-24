# 08 · Build plan

Each phase ends in something deployed and usable. Each phase also has a ready-to-paste prompt for Claude Code; it works locally or in Claude Code on the web against the GitHub repo. Run one phase per branch and PR.

| Phase | Outcome | Est. effort |
|---|---|---|
| 0 | Data-source decision + Oslo stations seeded | 1 week elapsed (mostly waiting for email replies), ~3 h work |
| 1 | Skeleton deployed: monorepo, Supabase, mock ingest, CI | 1 evening |
| 2 | **Find** screen working on real/mock data | 1–2 evenings |
| 3 | **Alerts** end-to-end (Telegram + email) | 2 evenings |
| 4 | Trends, PWA polish, Web Push, crowd photo reports | 2–3 evenings |
| 5 | Hardening: watchdog, backups, Lighthouse, a11y pass | 1 evening |

---

## Phase 0 · Data-source spike (go / no-go)

**Me (manual):**
- [ ] Send the outreach email ([01 §4](01-data-sources.md#outreach-email-template)) to DrivstoffAppen AS and Drivstoffprisene.
- [ ] Check the chains (Uno-X, YX, Circle K, Esso, St1, Best) for public station prices or terms, and fill in the table in 01.
- [ ] Create the free accounts: Supabase project (region **eu-north-1 Stockholm**), Vercel, Resend, Telegram bot via @BotFather.

**Claude Code prompt:**
> Read CLAUDE.md and docs/01-data-sources.md. Write a script `scripts/seed-osm-stations.ts` that queries the Overpass API for `amenity=fuel` within 30 km of Oslo S, and outputs `supabase/seed/oslo_stations_osm.sql` (insert into stations: name, brand from `brand`/`operator` tags, address, geom, osm_id). Normalise brand names to: Circle K, Uno-X, YX, Esso, St1, Best, Shell, Other. Print a summary per brand. Include the ODbL attribution in the file header.

**Exit:** a decision recorded in 01 about which rung of the source ladder we're on, and a seed file with about 120–200 stations.

## Phase 1 · Skeleton & pipeline

> Read CLAUDE.md and docs/02, 03, 05. Scaffold the pnpm monorepo exactly as in docs/02 §7: Next.js 15 app in apps/web (TypeScript strict, Tailwind v4, shadcn/ui init), packages/core (pure TS + Vitest), supabase/ (CLI config). Apply migration 0001_init.sql. Implement the `mock` SourceAdapter (≈120 Oslo stations from the seed, realistic intraday cycle: daily +1.2–1.8 NOK jump at ~12:00 then a linear drift down, ±0.15 noise, 2 % daily chance of a −2 NOK outlier on one station). Implement the `ingest` edge function per docs/05 §2 (store changes only, update price_current.last_seen_at otherwise, log to ingest_runs), plus `refresh_area_stats()` SQL. Add 0002_cron.sql with pg_cron jobs. Add GitHub Actions: ci.yml (lint, typecheck, vitest) and deploy.yml (supabase db push + functions deploy on main). Do not build UI yet beyond a page listing price_current rows.

**Exit:** prices tick in the prod DB every 20 min with no PC on, and CI is green.

## Phase 2 · Find screen

> Read docs/06 sections 1–4.2 and docs/04 §4. Implement the design tokens in globals.css, then the Find screen: filter chips, market status chip, MapLibre map with OpenFreeMap tiles and price-pill markers coloured by Δ vs ref price, vaul bottom sheet with list sorted by net saving via the `stations_near` RPC, hero "Best deal" row, all states (loading, empty, stale, offline, source down). Then the Station detail route with a 30-day step chart against the area median and a Navigate deep link. Add `market_status` and `station_history` RPCs in a new migration. Playwright smoke test: loads, shows ≥ 1 station, sort toggles work. Mobile-first, check at 375 px and 1440 px in both themes.

**Exit:** on my phone, the app shows the cheapest diesel near me within 2 s.

## Phase 3 · Alerts end-to-end

> Read docs/04 fully and docs/05 §2. In packages/core implement the market-drop, outlier and net-saving maths as pure functions, with every test fixture in docs/04 §7 as Vitest tests (they must pass). Mirror them in SQL: `refresh_area_baseline()` and `evaluate_alerts(run_id)`, inserting idempotent alert_events. Implement the `notify` edge function (quiet hours, digest, daily cap, revalidation, retries) with Telegram (grammy) and Resend + React Email templates exactly as in docs/04 §6. Implement `telegram-webhook` with /start linking, /near, /cheapest, /status, /mute and feedback callbacks. Build the Alerts page (feed + rule cards + channels + send-test) and onboarding. Magic-link auth.

**Exit:** a forced outlier from the mock adapter reaches my Telegram within 25 min, and a 30-day replay of the flat market produces zero alerts.

## Phase 4 · Trends, PWA, crowd input

> Read docs/06 §4.3, §5 and docs/05. Build the Trends page (area_trend, area_heatmap, SSB monthly overlay via the ssb_monthly cron that pulls table 09654), the Serwist PWA (manifest, icons, offline), the iOS install hint and Web Push (VAPID). Add crowd photo reports: Telegram photo → vision model extracts {fuel: price} → confirm buttons → crowd_reports → prices with confidence rules from docs/01. Add the target-price rule and the "you'd have got N alerts" replay preview.

## Phase 5 · Hardening

> Add watchdog.yml (daily; Telegram me if the last successful ingest_run is > 2 h old, alert failures > 0, or the Supabase project is paused) and backup.yml (weekly pg_dump → encrypted artifact, 90-day retention). Run Lighthouse and an axe accessibility audit, and fix everything below the bar in docs/00 §5. Write docs/RUNBOOK.md.

---

## Definition of done (every phase)
- CI green (lint, typecheck, unit tests). E2E smoke passes where relevant.
- Deployed to prod and checked on a real phone.
- The docs are updated if behaviour diverged from the spec. **The specs are living documents.**
