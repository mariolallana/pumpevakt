# 00 · Product requirements (lean v3)

## 1. Problem
Diesel prices around Oslo differ by up to ~5 kr/L between stations (22.85–28.34 on 2026-10-24) and swing week to week. I want to know **where** to fill up and **when**, without opening an app.

## 2. User and interface
- **One user: me** (Oslo, diesel car). No accounts or auth ([10](10-design-review.md) challenge 3).
- **Telegram bot first** (instant push on every phone, nothing to install).
- A **read-only web dashboard** (map and trend) comes in Phase 4.

## 3. MVP scope (all on open, keyless data, [01](01-data-sources.md))

| ID | Feature | Data |
|---|---|---|
| M1 | **Best deal near me**: `/near` (shared location or Home) → top 5 by net saving after the detour, with price age | drivstoffapp.no |
| M2 | **Market-drop alarm**: the Oslo median price fell sharply compared with its own recent history | Oslo median (collected every 30 min) |
| M3 | **Cheap-station alarm**: a station around Oslo is priced well below its neighbours | Same |
| M4 | `/status`: Oslo median today vs 14-day median, trend sparkline, cheapest 3 right now, WDI early-warning line | Same + FRED/Norges Bank |
| M5 | Health: a Telegram ⚠️ if a data job fails twice in a row | Runs log |

Later: web dashboard (Phase 4), market-rise "fill up now" warning, petrol/HVO alerts, Norwegian UI.

## 4. Non-functional
| Area | Requirement |
|---|---|
| Cost | 0 NOK/month. No paid APIs, no keys except the Telegram bot token |
| No local PC | Cloudflare Worker + GitHub Actions |
| Freshness | Prices polled every 30 min. Every price shows its age. Prices > 24 h old are never ranked |
| Alert quality | ≤ 1 noisy alert per week. 👍/👎 on each. 14-day shadow mode before going live |
| Source etiquette | ~150 requests/day to drivstoffapp.no, an honest User-Agent, attribution in every message |
| Simplicity | One Worker, one D1 database, one language |

## 5. Success metrics
- Saving ≥ 1 kr/L vs the Oslo median when I fill up (logged with a "⛽ filled here" button).
- ≤ 1 👎 per week after shadow mode.
- Zero days with a silent data failure.
