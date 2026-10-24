# 05 · Interfaces

## 1. Telegram bot (primary UI)

All commands work only for `ALLOWED_CHAT_IDS`. Others get no reply.

| Command | Reply |
|---|---|
| `/start` | Welcome text and your chat ID (to paste into config the first time) |
| `/status` | WDI today, 5-day and 30-day change, a sparkline (`▁▂▃▅▇`), national pump average, last signal, data freshness |
| `/near` or 📍 shared location | Top 5 stations by net saving within 10 km using prices ≤ 24 h old. If there are fewer than 3 priced stations: the 5 nearest stations plus "no fresh prices, send one with /p" |
| `/p <station words> <fuel> <price>` e.g. `/p uno-x ryen d 20.89` | Fuzzy-match the station (name/brand/address tokens, near Home or the last shared location). Confirm with buttons ✅ / pick another of the top 3. Fuel shorthand: `d` = diesel, `95`, `98`, `hvo` |
| `/health` | Last run per job, failures, row counts |
| `/mute 24h` · `/unmute` | Pause or resume pushes |
| `/shadow on|off` | Calibration mode ([04 §4](04-alert-engine.md#4-shadow-mode--feedback)) |
| callback `fb:<alert_id>:up|down` | Stores feedback |

Telegram webhook: `POST /telegram` with header `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET`. Set it once with `setWebhook`.

## 2. HTTP routes on the Worker

| Route | Auth | Purpose |
|---|---|---|
| `POST /telegram` | Telegram secret header | Bot |
| `GET /health` | none (no sensitive data) | `{ jobs: { market: { lastOk, lastError }, stations: {…} } }`. Used by the weekly Action |
| `GET /api/market?days=90` | none | Phase 4 dashboard: WDI and national series |
| `GET /api/stations?lat&lon&radius_km&fuel` | none | Phase 4 dashboard: stations with latest price, age and net saving |

Public, read-only, no personal data. If the dashboard ever shows reports by friends, drop `reporter` from the API output.

## 3. Cron triggers (`wrangler.toml`)

```toml
[triggers]
crons = ["30 6 * * *", "30 17 * * *", "0 */12 * * *"]   # market ×2 (UTC), station prices every 12 h
```

`scheduled()` dispatches on `event.cron`. Every job writes a `runs` row, and two consecutive failures trigger a Telegram ⚠️.

## 4. Source adapter contract

```ts
// src/sources/types.ts
export type Fuel = 'diesel' | 'petrol95' | 'petrol98' | 'hvo100';

export interface StationPrice {
  stationId: string;      // our stations.id
  fuel: Fuel;
  price: number;          // NOK/L incl. VAT
  observedAt: string;     // ISO, when the price was seen
  source: string;
}

export interface MarketPoint { day: string; series: string; value: number }

export interface StationSource { id: string; fetch(signal: AbortSignal): Promise<StationPrice[]> }
export interface MarketSource  { id: string; fetch(signal: AbortSignal): Promise<MarketPoint[]> }
```

Rules: adapters are pure fetch-and-map with no DB access, use a 15 s timeout, drop tax-free diesel, and ship a recorded fixture with a mapping test.

Initial adapters: `fred` (ULSD + Brent), `norgesBank` (USD/NOK), `openvan` (national avg), `ssb` (monthly, run on the 10th), `drivstoffpriser` (station prices, ODbL). Gated: `googlePlaces`, `partner`.
