# 03 · Data model

The authoritative schema is in [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql). This doc explains it.

## Entity overview

```
stations 1─* station_source_ids          profiles 1─* saved_places
stations 1─* prices (append-only)        profiles 1─* notification_channels
stations 1─* price_current (1 per fuel)  profiles 1─* alert_rules 1─* alert_events
area_stats_15m  (Oslo-area median etc. per 15-min bucket per fuel)
area_baseline   (rolling baseline per fuel × hour-of-week)
ingest_runs     (observability)          crowd_reports (v1)
```

## Tables

| Table | Key columns | Notes |
|---|---|---|
| `stations` | `id uuid`, `name`, `brand`, `address`, `geom geography(Point)`, `osm_id`, `is_active` | Master data, seeded from OSM and enriched by sources |
| `station_source_ids` | `(source, source_station_id)` PK → `station_id` | Cross-source matching |
| `prices` | `id bigserial`, `station_id`, `fuel`, `price_nok numeric(6,2)`, `observed_at`, `source`, `confidence` | **Append-only, written only on change.** Index `(station_id, fuel, observed_at desc)` |
| `price_current` | PK `(station_id, fuel)`, `price_nok`, `observed_at`, `last_seen_at`, `source`, `confidence` | Hot table for reads. Upserted by ingest |
| `area_stats_15m` | PK `(area, fuel, bucket)`, `median`, `p10`, `p25`, `mad`, `n_fresh` | `area='oslo'` = stations within 25 km of Oslo S. Built from *fresh* prices only (≤ 6 h) |
| `area_baseline` | PK `(area, fuel, how_band)`, `median_14d`, `median_28d`, `updated_at` | `how_band` = hour-of-week band (0–41, 4-hour bands). Recomputed nightly |
| `profiles` | `id` (= auth.uid), `fuel`, `tank_l`, `consumption_l100`, `radius_km`, `sensitivity`, `quiet_from`, `quiet_to`, `tz` | One per user |
| `saved_places` | `id`, `user_id`, `label`, `geom` | Home, Work … |
| `notification_channels` | `id`, `user_id`, `kind` (`telegram`/`email`/`webpush`), `address jsonb`, `verified_at`, `enabled` | Telegram `chat_id`, email, push subscription |
| `alert_rules` | `id`, `user_id`, `kind` (`market_drop`/`outlier`/`target_price`), `fuel`, `place_id`, `params jsonb`, `enabled` | Defaults are created when the profile is created |
| `alert_events` | `id`, `rule_id`, `dedupe_key` UNIQUE, `payload jsonb`, `status` (`pending`/`sent`/`deferred`/`failed`), `sent_at`, `feedback` (`up`/`down`) | Idempotent by `dedupe_key` |
| `ingest_runs` | `id`, `started_at`, `finished_at`, `source`, `n_obs`, `n_changes`, `error` | Watchdog reads this |
| `crowd_reports` (v1) | `id`, `user_id`, `station_id`, `fuel`, `price_nok`, `photo_path`, `status` | Becomes a `prices` row on confirm |

## Enums
- `fuel_type`: `diesel`, `petrol95`, `petrol98`, `hvo100`. (Tax-free diesel is deliberately absent.)
- `alert_kind`: `market_drop`, `outlier`, `target_price`.

## Retention
- `prices`: keep forever. It is small and needed for history.
- `area_stats_15m`: keep 400 days, then downsample to daily into `area_stats_daily` (nightly job).
- `ingest_runs`: 30 days.
- `alert_events`: 1 year.

## Security (RLS)
- Public read for `stations`, `price_current`, `prices`, `area_*` through the anon key, since price data is not personal. Write access is service role only.
- `profiles`, `saved_places`, `notification_channels`, `alert_rules`, `alert_events`: `user_id = auth.uid()` only.
- Edge functions use the service role key, which is stored in Supabase secrets and never shipped to the client.
