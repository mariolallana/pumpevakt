# 08 · Build plan (lean v2)

Every phase ends deployed and usable. Work one branch and PR per phase. Estimates are realistic for evening sessions with Claude Code, including debugging.

| Phase | Outcome | Estimate | Status |
|---|---|---|---|
| 0 | Data feasibility proven | — | ✅ **Done 2026-10-24** ([01](01-data-sources.md)) |
| 0b | Unlock attempts: Google Places probe, partner emails | 30 min of my time, then wait | ⏳ |
| 1 | Worker + D1 + market job + historical replay of the signal | 2–3 evenings | |
| 2 | Telegram bot: `/status`, market alarms in shadow mode, `/health`, failure pings | 2 evenings | |
| 3 | Stations: weekly import, `/near`, `/p` reports, net saving | 2 evenings | |
| — | *14 days of shadow mode → tune → `/shadow off`* | elapsed time | |
| 4 | **Gated (G1–G3):** live station adapter, outlier alarm, web dashboard | 3–5 evenings | 🔒 |
| 5 | Optional: photo price reports, friends as reporters | 2 evenings | |

---

## Phase 0b · Unlock attempts (me)
- [ ] Create a Google Cloud API key with Places API (New) enabled, then run `GOOGLE_MAPS_API_KEY=… node scripts/probe-google-places.mjs`. Paste the verdict into [01 §1](01-data-sources.md#1-what-we-tested) row 10.
- [ ] Send the partner emails ([01 §4](01-data-sources.md#outreach-email-send-to-postdrivstoffappenno-and-the-drivstoffprisene-contact)).
- [ ] Create accounts: Cloudflare (free), a Telegram bot via @BotFather.

## Phase 1 · Worker, D1 and the market signal
> Read CLAUDE.md, docs/01 §2, docs/02, docs/03, docs/04 §1 and §7. Scaffold the repo per docs/02 §6: TypeScript strict, Wrangler, D1 with db/schema.sql as migration 0001, Vitest. Implement market sources (fred, norgesBank, openvan, ssb) per the contract in docs/05 §4, each with a recorded fixture and a mapping test. Implement src/core/wdi.ts and src/core/signals.ts (market_drop, market_rise, tax detector, dedupe keys) with every docs/04 §7 market fixture as a test. Implement scheduled() for the market cron, writing market_daily, alerts (shadow=1) and runs. Add scripts/replay-signals.mjs: run signals.ts over daily WDI from 2015 to today, print alerts per year per sensitivity and the share followed by the national/SSB pump price moving the same way, and record the results in docs/04 §1. Add .github/workflows/ci.yml (typecheck + vitest) and deploy.yml (d1 migrations apply + wrangler deploy on main). No Telegram yet.

**Exit:** `market_daily` fills twice a day in prod, the replay results are in docs/04, and CI is green.

## Phase 2 · Telegram bot
> Read docs/05 §1–3 and docs/06 §1. Add grammY on the Worker at POST /telegram with the secret-header check and the ALLOWED_CHAT_IDS allowlist. Commands: /start, /status (format exactly as docs/06), /health, /mute, /unmute, /shadow. Send pending non-shadow alerts after each market job using the docs/04 §6 templates, honouring quiet hours and the 3/day cap, and send the daily 18:00 shadow digest with 👍/👎 callbacks stored in alerts.feedback. Two consecutive failed runs → ⚠️ message. Document setWebhook in the README.

**Exit:** `/status` works from my phone and the shadow digest arrives daily.

## Phase 3 · Stations, /near and /p
> Read docs/01 §3, docs/04 §2–3 and docs/05 §1. Write scripts/import-stations.mjs (download Drivstoffpriser stations.json → upsert into D1 via `wrangler d1 execute`, ODbL attribution) and .github/workflows/weekly.yml (import + `wrangler d1 export` backup as an artifact + curl /health, failing loudly). Implement src/core/geo.ts and netSaving.ts with tests, the drivstoffpriser station-price adapter (12 h cron, change-only inserts), /near (shared location or Home) and /p with fuzzy station match and confirm buttons, per docs/06 layouts. Outlier rule from docs/04 §2 runs on reports only, behind a feature flag.

**Exit:** I can report a price in under 10 seconds and `/near` shows it.

## Phase 4 · Gated: live station data and dashboard
Start when one unlock in [01 §4](01-data-sources.md#4-gates-and-unlocks) succeeds.
> Add the unlocked adapter (googlePlaces or partner) at 30-min cadence within its licence, enable the outlier alarm, and build the web/ Vite + React dashboard (Market + Map views) per docs/06 §2, reading GET /api/market and /api/stations, deployed to Cloudflare Pages.

## Definition of done (each phase)
CI green · deployed · checked from my phone · the docs updated if behaviour diverged.
