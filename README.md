# Pumpevakt ⛽ — cheapest diesel near me, and alerts when Oslo prices drop

> Working name. *Pumpevakt* means "pump guard". It's a personal Telegram bot, with a read-only dashboard later.

- `/near` → the best deal near me, ranked by real saving after the detour, with the age of every price.
- 📉 **Market-drop alarm**: the Oslo median price fell sharply compared with its last 14 days.
- 💥 **Cheap-station alarm**: one station around Oslo is priced well below its neighbours.

**Data: open, keyless endpoints only.** Station prices come from the public [drivstoffapp.no API](https://backend.drivstoffapp.no/docs). On 2026-10-24, 95 of 100 Oslo stations had a diesel price under 24 h old. Market context comes from FRED + Norges Bank (a wholesale index with 0.92 correlation to official pump prices).

## Run the feasibility tests yourself
```bash
node scripts/probe-sources.mjs        # every source: OK / STALE / FAIL
node scripts/backtest-wholesale.mjs   # wholesale index vs SSB official pump prices, 2015 → today
```

## Architecture
One **Cloudflare Worker** (30-min cron + Telegram webhook) with **D1** (SQLite), deployed by GitHub Actions. Free, and nothing runs on my PC.

## Specs
| # | Doc |
|---|---|
| 00 | [Product requirements](docs/00-product-requirements.md) |
| 01 | [Data sources](docs/01-data-sources.md) |
| 02 | [Architecture](docs/02-architecture.md) |
| 03 | [Data model](docs/03-data-model.md) · [schema.sql](db/schema.sql) |
| 04 | [Alert engine](docs/04-alert-engine.md) |
| 05 | [Interfaces](docs/05-api-spec.md) |
| 06 | [UX / UI](docs/06-ux-ui-spec.md) |
| 07 | [Tech stack](docs/07-tech-stack.md) |
| 08 | [Build plan + Claude Code prompts](docs/08-build-plan.md) |
| 09 | [Ops, security, cost](docs/09-ops-security-cost.md) |
| 10 | [Design review log](docs/10-design-review.md) |

## Status
✅ Phase 0 (data sources) done 2026-10-24 · Next: Phase 1.

Prices: drivstoffapp.no · Market: FRED, Norges Bank, SSB (CC BY 4.0).
