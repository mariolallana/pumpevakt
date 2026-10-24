# 08 · Build plan (lean v3)

One branch and PR per phase. Each phase ends deployed and checked on my phone.

| Phase | Outcome | Estimate | Status |
|---|---|---|---|
| 0 | Open data sources found and tested | — | ✅ Done 2026-10-24 |
| 1 | Worker + D1 collecting Oslo prices every 30 min, plus WDI daily | 2 evenings | |
| 2 | Telegram bot: `/near`, `/status`, `/health`, failure pings | 2 evenings | |
| 3 | Alarms: market drop + cheap station, in shadow mode | 2 evenings | |
| — | *14 days of shadow mode → tune thresholds → `/shadow off`* | elapsed time | |
| 4 | Web dashboard (map + trend), read-only | 3 evenings | |

**Before Phase 1 (me, 15 min):** create a free Cloudflare account and a Telegram bot via @BotFather (keep the token), then send `/start` to get my chat ID.

## Phase 1 · Collect data
> Read CLAUDE.md, docs/01, docs/02, docs/03. Scaffold per docs/02 §6: TypeScript strict, Wrangler, D1 with db/schema.sql as migration 0001, Vitest. Implement src/sources/drivstoffapp.ts (3 centres, dedupe, field mapping from docs/01 §2, ignore fd_price, honest User-Agent, 15 s timeout) with a recorded fixture test, plus fred.ts and norgesBank.ts with fixtures. Implement scheduled(): every 30 min the prices job (upsert stations, change-only price inserts, Oslo median into market_daily) and daily 06:30 UTC the WDI job; every run writes to runs. Add ci.yml and deploy.yml. Check Worker CPU time with wrangler tail and report it.

**Exit:** prod D1 fills every 30 min, CPU per run is measured, CI is green.

## Phase 2 · Telegram bot
> Read docs/05 and docs/06 §1. grammY at POST /telegram with the secret header + ALLOWED_CHAT_IDS. Commands /start, /near (shared location or Home; top 5 by net saving from src/core/netSaving.ts; Navigate buttons), /status, /health, /mute, /unmute. Two failed runs in a row → ⚠️ message. Document setWebhook in the README.

**Exit:** `/near` gives me the best deal near me from my phone.

## Phase 3 · Alarms
> Read docs/04 fully. Implement src/core/signals.ts (market drop, cheap station, dedupe, plausibility, revalidation) with every docs/04 §6 fixture as a Vitest test. Wire it into the prices job. Shadow mode plus the daily 18:00 digest with 👍/👎, quiet hours, 3/day cap, /shadow command. Add weekly.yml (D1 export backup + /health check).

**Exit:** the shadow digest arrives daily. After 14 days, tune the thresholds in docs/04 and run `/shadow off`.

## Phase 4 · Dashboard
> Read docs/06 §2. Add GET /api/stations and /api/market to the Worker. Build web/ (Vite + React + Tailwind + shadcn/ui + MapLibre/OpenFreeMap + Recharts) with two views, Map and Market, deployed to Cloudflare Pages.

## Definition of done
CI green · deployed · checked on my phone · the docs updated if behaviour diverged.
