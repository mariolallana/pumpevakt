# 05 · Interfaces

## 1. Telegram bot (primary UI)
Only `ALLOWED_CHAT_IDS` get replies.

| Command | Reply |
|---|---|
| `/start` | Welcome text and your chat ID (to paste into config the first time) |
| `/near` or 📍 shared location | Top 5 stations by net saving within `RADIUS_KM` (default 10) using fresh prices, each with price, distance, age, saving and a 🧭 Navigate button (Google Maps link) |
| `/status` | Oslo median now vs 14-day normal, 14-day sparkline `▁▂▃▅▇`, cheapest 3 in Oslo, WDI line, data freshness |
| `/health` | Last run per job, failures, number of fresh stations |
| `/mute 24h` · `/unmute` | Pause or resume pushes |
| `/shadow on\|off` | Calibration mode ([04 §4](04-alert-engine.md)) |
| callback `fb:<alert_id>:up\|down` | Stores feedback |
| callback `filled:<station_id>` | Logs "filled here" (for the savings metric) |

Webhook: `POST /telegram` with `X-Telegram-Bot-Api-Secret-Token`. Register it once with `setWebhook`.

## 2. Worker HTTP routes
| Route | Purpose |
|---|---|
| `POST /telegram` | Bot |
| `GET /health` | `{ jobs: { prices: {lastOk, lastError, nFresh}, market: {…} } }`. Used by the weekly Action |
| `GET /api/stations?lat&lon&radius_km&fuel` | Phase 4: stations with latest price, age, net saving |
| `GET /api/market?days=90` | Phase 4: Oslo daily median + WDI series |

Read-only, no personal data.

## 3. Cron triggers
```toml
[triggers]
crons = ["*/30 * * * *", "30 6 * * *"]   # prices job (every 30 min), WDI job (daily, UTC)
```

## 4. Adapter contract
```ts
export type Fuel = 'diesel' | 'petrol95' | 'petrol98' | 'hvo100';

export interface StationObs {
  station: { id: string; name: string; brand: string; address: string; lat: number; lon: number };
  fuel: Fuel;
  price: number;       // NOK/L incl. VAT
  observedAt: string;  // ISO, the per-fuel updated_at from the source
}
export interface MarketPoint { day: string; series: string; value: number }
```
Adapters: `drivstoffapp` (→ `StationObs[]`), `fred` and `norgesBank` (→ `MarketPoint[]`). They are pure fetch-and-map with no DB access, use a 15 s timeout, and ship a recorded fixture with a test.
