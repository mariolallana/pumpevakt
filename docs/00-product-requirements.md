# 00 · Product requirements (lean v2)

## 1. Problem
Fuel prices in Norway swing by several NOK/L within weeks. I want to know **when** to fill up (the market is falling, so wait; it's about to rise, so fill now) and, once data allows, **where** (cheapest near me), without opening an app.

## 2. User
**One user: me** (Oslo, diesel car). Friends may join later as *reporters* in the Telegram group, but they are not app users with accounts. No auth, no profiles, no multi-tenancy (see [10](10-design-review.md) challenge 3).

## 3. Interface
**Telegram bot first** (MVP). It's free, gives instant push on every phone and needs no app store. A **read-only web dashboard** (map plus trend chart) comes in Phase 4, only once station prices exist ([06](06-ux-ui-spec.md)).

## 4. Scope

### MVP: works on open data today
| ID | Feature | Data | Notes |
|---|---|---|---|
| M1 | **Market alarm**: "Diesel market cost fell 6 % in 5 days. Pumps usually follow within days, so wait if you can" and the reverse "rising, fill up now" | WDI + OpenVan ([01 §2](01-data-sources.md#2-the-creative-unlock-the-wholesale-diesel-index-wdi)) | Shadow mode for the first 14 days |
| M2 | `/status`: today's WDI, 30-day trend, national pump average, last signal | Same | |
| M3 | `/p <station> <fuel> <price>`: report a price I see (station fuzzy-matched by name, or by shared location) | Own reports | Builds my own price history |
| M4 | `/near` (share location): stations near me, plus any price reported in the last 24 h, ranked by net saving | Stations + reports | Sparse until the gate opens, and says so honestly |
| M5 | Health: the bot tells me if a data job fails twice in a row | Runs log | |

### Gated: unlocks when station data exists ([01 §4](01-data-sources.md#4-gates-and-unlocks))
| ID | Feature |
|---|---|
| G1 | **Cheap-station (outlier) alarm** around Oslo |
| G2 | Full "best deal near me", ranked by net saving |
| G3 | Web dashboard with a map of live prices |

### Later
Photo price reports (AI extraction), web trend page, friends as reporters, Norwegian UI language.

## 5. Non-functional
| Area | Requirement |
|---|---|
| Cost | 0 NOK/month on free tiers. Optional AI photo extraction costs cents |
| No local PC | Everything runs on Cloudflare plus GitHub Actions |
| Freshness | Market data refreshed twice daily. Station reports shown with their age, and hidden after 24 h |
| Alert quality | ≤ 1 noisy alert per week. Each alert has 👍/👎. Shadow mode before going live |
| Privacy | The bot answers only allow-listed chat IDs. Shared locations are used for the query and not stored |
| Simplicity | One deployable (one Cloudflare Worker), one database (D1), one language (TypeScript) |

## 6. Success metrics
- Within 60 days, at least 2 market alarms that I rate 👍.
- ≤ 1 👎 per week after shadow mode ends.
- Phase 0 unlock decided (Google Places probe run, partner emails answered or 3 weeks passed).
