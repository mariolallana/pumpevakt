# 00 · Product requirements

## 1. Problem

Fuel prices in Norway move several times a day, and stations a few kilometres apart can differ by 2–3 NOK/L. Existing apps answer "what does it cost here now?". They don't tell you **when** it is worth filling up, or **whether** the cheap station is worth the detour, and they don't alert you unless you open them.

## 2. Primary user

**Me (single user, Oslo).** I drive a diesel car and live and commute around Oslo. I want to spend zero effort and get a nudge only when it matters. The design leaves room for a few friends or family later (multi-user ready, not multi-tenant SaaS).

## 3. Jobs to be done

| ID | When… | I want to… | So that… |
|----|-------|-----------|----------|
| J1 | I need fuel now | see the cheapest stations within *R* km, ranked by **net saving after detour** | I don't drive 8 km to save 4 NOK |
| J2 | I'm not in a hurry | be told when Oslo prices are unusually low | I time my fill-up |
| J3 | Any time | be told when one station is far below everyone else | I catch real bargains (price errors, opening deals, price wars) |
| J4 | I'm curious | see the price history and typical weekly pattern around Oslo | I learn when to fill up |

## 4. Scope

### MVP (Phase 1–3): "it works for me"
- Map and list of stations within a radius (default 5 km, range 1–30 km) of my GPS position or a saved place (Home, Work).
- Fuel type filter: Diesel (default), 95, 98, HVO100.
- Each station shows price, **age of price** ("12 min ago"), brand and distance. Sorting options: Net saving (default), Price, Distance.
- Station detail: price history sparkline (7 / 30 days), directions deep link (Google Maps / Apple Maps).
- **Market-drop alarm** and **outlier alarm** ([04](04-alert-engine.md)), delivered by Telegram plus email.
- Settings: fuel type, tank size, consumption (L/100 km), home location, alert sensitivity, quiet hours, channels.
- Installable PWA, works on phone, readable from any device. No local PC involved.

### v1 (Phase 4)
- Oslo trend page: 30/90-day area median chart, hour-of-week heatmap ("cheapest time to fill"), SSB national monthly context.
- Web Push channel.
- "Report a price" (crowd input) from the app and the Telegram bot, including a photo of the price sign → AI extraction → confirm. Needed if the primary source is thin ([01](01-data-sources.md)).
- Favourite stations, and a personal price-target alert ("ping me when diesel ≤ 21.00 within 5 km").

### Later / not now
- Multi-city, EV charging prices, native apps, social features, monetisation.

## 5. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Cost | 0 NOK/month. Every component on a free tier with ≥ 3× headroom ([09](09-ops-security-cost.md)) |
| Availability | Runs 24/7 in the cloud. Ingestion failures self-report to Telegram within 2 h |
| Freshness | Station prices ≤ 20 min behind the source. Prices older than 6 h are flagged "stale", and prices older than 24 h are hidden from ranking |
| Alert latency | ≤ 25 min from the price appearing at the source to the message on my phone |
| Alert precision | ≤ 1 false or annoying alert per week. Spam kills the product, so de-duplication and cooldowns are mandatory |
| Performance | Lighthouse mobile ≥ 90. First map render < 2 s on 4G |
| Privacy | Location is processed client-side. Only *saved places* are stored server-side. Row-level security on all user tables |
| Accessibility | WCAG 2.2 AA, light and dark themes |
| Language | UI in English first. Strings externalised so Norwegian (nb) can be added |

## 6. Success metrics (personal)

- I open the app at most 2×/week, because alerts do the work.
- Average saving ≥ 1 NOK/L versus the Oslo median at the time of fill-up (tracked via an optional "I filled up here" button).
- ≤ 1 alert I'd call noise per week, measured with a 👍/👎 feedback button on each alert.

## 7. Open questions

1. **Data licence**: which source will we have legitimate access to? Phase 0 answers this ([01](01-data-sources.md)).
2. Diesel only, or also petrol? Assume both are supported and diesel is the default.
3. Should alerts also cover "near Work" or "along my commute"? Proposed for v1 as multiple saved places.
