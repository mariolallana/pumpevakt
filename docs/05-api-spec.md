# 05 · API spec

The client talks to Supabase directly: PostgREST tables and RPCs under RLS. Custom logic lives in three Edge Functions. There is no separate backend server.

## 1. Client-facing RPCs (Postgres functions)

| RPC | Args | Returns | Used by |
|---|---|---|---|
| `stations_near` | `p_lat, p_lon, p_radius_km=5, p_fuel='diesel', p_tank_l=50, p_consumption_l100=6.5` | rows: station, price, `observed_at`, `is_stale`, `distance_km`, `ref_price`, `net_saving_nok` (sorted by saving) | Map/list home |
| `station_history` | `p_station_id, p_fuel, p_days=30` | `[{observed_at, price_nok}]` step series | Station detail sparkline |
| `area_trend` | `p_area='oslo', p_fuel, p_days=90` | daily `{day, median, min}` + latest `L`, `B`, `drop_pct` | Trends page, header chip |
| `area_heatmap` | `p_area, p_fuel` | 42 × `{how_band, median_28d}` | "Best time to fill" heatmap |
| `market_status` | `p_fuel` | `{level, baseline, drop_abs, drop_pct, label: 'cheap'|'normal'|'expensive', n_fresh, updated_at}` | Status chip at top of the app |

Direct table access (RLS): `profiles`, `saved_places`, `alert_rules`, `notification_channels`, `alert_events` (read plus `feedback` update).

## 2. Edge Functions

All require `Authorization: Bearer <secret>`. Cron calls use `CRON_SECRET`, and the Telegram webhook verifies `X-Telegram-Bot-Api-Secret-Token`.

### `POST /functions/v1/ingest`
- Body: `{ "sources"?: string[], "dryRun"?: boolean }`
- Runs the enabled adapters → upsert → `refresh_area_stats()` → `evaluate_alerts()`.
- Response: `{ runId, perSource: [{source, nObs, nChanges, ms, error?}], alertsCreated }`

### `POST /functions/v1/notify`
- Body: `{}`. Drains `alert_events` where status is `pending`, or `deferred` and due.
- Response: `{ sent, deferred, expired, failed }`

### `POST /functions/v1/telegram-webhook`
| Command / input | Behaviour |
|---|---|
| `/start <link_code>` | Links the chat to the user. The code comes from Settings → "Connect Telegram" (deep link `t.me/<bot>?start=<code>`, valid 15 min) |
| `/near` or 📍 location share | Top 5 by net saving around the shared location |
| `/cheapest` | Top 5 in the Oslo area right now |
| `/status` | Market status chip as text |
| `/mute 6h` · `/unmute` | Temporarily disables alerts |
| 📷 photo (v1) | AI extracts `{brand?, fuel→price}` from the price sign → bot replies "Uno-X Ryen? Diesel 20.89, 95 22.10 ✅ / ✏️", then a `crowd_reports` row on confirm |
| callback `fb:up|down:<event_id>` | Stores feedback |

### `POST /functions/v1/push-subscribe` (v1)
Stores a Web Push subscription (VAPID) as a `notification_channels` row.

## 3. Cron schedule (`0002_cron.sql`)

| Job | Schedule | Action |
|---|---|---|
| `ingest` | `*/20 * * * *` | `net.http_post(ingest)` |
| `notify` | `*/2 * * * *` | `net.http_post(notify)` |
| `baseline` | `15 3 * * *` | `refresh_area_baseline()` |
| `daily_rollup` | `30 3 * * *` | Downsample stats to `area_stats_daily`. Apply retention |
| `ssb_monthly` | `0 6 10 * *` | Pull SSB table 09654 latest month (for plausibility bounds and trends) |

## 4. Source adapter contract

```ts
// supabase/functions/_shared/adapters/types.ts
export type Fuel = 'diesel' | 'petrol95' | 'petrol98' | 'hvo100';

export interface NormalizedObservation {
  source: string;
  sourceStationId: string;
  station?: { name: string; brand: string; address?: string; lat: number; lon: number };
  fuel: Fuel;
  priceNok: number;      // incl. VAT, 2 decimals
  observedAt: string;    // ISO-8601. When the price was set or seen
  confidence: number;    // 0..1
}

export interface SourceAdapter {
  id: string;                         // 'mock' | 'partner_x' | 'chain_unox' | 'crowd' …
  enabled(env: Env): boolean;         // feature-flag via env/secrets
  fetch(ctx: { bbox: [number, number, number, number]; since?: Date; signal: AbortSignal })
    : Promise<NormalizedObservation[]>;
}
```

Adapter rules:
1. **Pure fetch and map.** No DB access. Ingest owns persistence.
2. Must filter to the Oslo bbox `[10.2, 59.6, 11.3, 60.2]` (lon/lat) when the source supports it.
3. Must map only allowed fuels and drop tax-free diesel.
4. Must honour `signal` (20 s timeout) and the source's rate limits. Polling interval ≥ 20 min unless the licence allows more.
5. Each adapter ships a recorded fixture (`__fixtures__/<id>.json`) and a mapping unit test.

## 5. Error model

Edge functions return `{ error: { code, message } }` with HTTP 4xx/5xx. Codes: `UNAUTHORIZED`, `BAD_INPUT`, `SOURCE_FAILED`, `RATE_LIMITED`, `INTERNAL`. Every ingest error is also written to `ingest_runs.error`.
