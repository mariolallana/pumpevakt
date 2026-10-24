# Pumpevakt ⛽ — know when (and where) to fill up in Oslo

> Working name. *Pumpevakt* means "pump guard". It's a personal Telegram bot, with a dashboard later.

**What it does today, on 100 % open data:**
- 📉📈 **Market alarms**: tells me when the diesel market is falling sharply (wait) or rising (fill up now). It uses a Wholesale Diesel Index built from FRED and Norges Bank data, which tracks Norwegian pump prices with **0.92 correlation** over 10 years ([backtest](docs/01-data-sources.md#2-the-creative-unlock-the-wholesale-diesel-index-wdi)).
- `/status`, `/near` and `/p` (report a price) in Telegram, with 158 Oslo stations from open ODbL data.

**Unlocks later:** the cheap-station alarm and a live-price map, as soon as a station-level price source opens up ([gates](docs/01-data-sources.md#4-gates-and-unlocks)).

## Feasibility: run it yourself
```bash
node scripts/probe-sources.mjs        # tests all 8 open sources (OK / STALE / FAIL)
node scripts/backtest-wholesale.mjs   # WDI vs SSB official pump prices, 2015 → today
GOOGLE_MAPS_API_KEY=… node scripts/probe-google-places.mjs   # does Google have Oslo fuel prices?
```

## Architecture in one line
One **Cloudflare Worker** (cron jobs + Telegram webhook + read-only JSON API) with **D1** (SQLite), deployed by GitHub Actions. Free, serverless, and nothing runs on my PC.

## Specs
| # | Doc |
|---|---|
| 00 | [Product requirements](docs/00-product-requirements.md) |
| 01 | [Data sources & feasibility](docs/01-data-sources.md) ← start here |
| 02 | [Architecture](docs/02-architecture.md) |
| 03 | [Data model](docs/03-data-model.md) · [schema.sql](db/schema.sql) |
| 04 | [Alert engine](docs/04-alert-engine.md) |
| 05 | [Interfaces (bot, routes, adapters)](docs/05-api-spec.md) |
| 06 | [UX / UI](docs/06-ux-ui-spec.md) |
| 07 | [Tech stack](docs/07-tech-stack.md) |
| 08 | [Build plan + Claude Code prompts](docs/08-build-plan.md) |
| 09 | [Ops, security, cost](docs/09-ops-security-cost.md) |
| 10 | [Design review log](docs/10-design-review.md) |

## Status
- ✅ Phase 0 (feasibility) done 2026-10-24.
- ⏳ Phase 0b: Google Places probe and partner emails.
- Next: Phase 1.

Data: FRED · Norges Bank · SSB (CC BY 4.0) · OpenVan · stations © Drivstoffpriser contributors & OpenStreetMap contributors (ODbL).
