# 03 · Data model (D1 / SQLite)

Schema: [`db/schema.sql`](../db/schema.sql). There are seven tables. User and rule tables were removed on purpose: one user, with config in env vars (see [10](10-design-review.md) challenge 3).

| Table | Purpose | Size / year |
|---|---|---|
| `stations` | ~160 Oslo-area stations, upserted from each drivstoffapp.no response (id, name, brand, address, lat/lon) | ~200 rows |
| `prices` | Append-only station prices, written **only on change** | ~100–150k rows/yr (~15 MB) |
| `market_daily` | One value per day per series: **`oslo_diesel_median`** (drives the market alarm), ULSD, USD/NOK, WDI | ~2k rows |
| `alerts` | Every signal, sent or shadow. `dedupe_key` makes them idempotent. Holds 👍/👎 feedback | < 200 |
| `runs` | One row per job run. Feeds `/health` and the failure ping | ~1.5k, pruned to 30 days |
| `fillups` | "⛽ filled here" taps (price vs Oslo median), for the savings metric | < 100 |
| `settings` | Runtime toggles from the bot (`muted_until`, `shadow`) | a handful |

## Config (env vars in `wrangler.toml` and secrets, typed in `src/config.ts`)

| Key | Example | Notes |
|---|---|---|
| `HOME_LAT`, `HOME_LON` | 59.93, 10.80 | Used for `/near` when no location is shared |
| `FUEL` | `diesel` | |
| `TANK_L`, `CONSUMPTION_L100` | 50, 6.5 | Net-saving calculation |
| `SENSITIVITY` | `normal` | `relaxed` / `normal` / `eager` ([04](04-alert-engine.md)) |
| `QUIET_HOURS` | `22-07` | Europe/Oslo |
| `ALLOWED_CHAT_IDS` | `123456789` | Comma list. The bot ignores everyone else |
| secret `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | — | `wrangler secret put` |

## Retention
`prices`, `market_daily`, `alerts`: keep forever (tiny). `runs`: 30 days (pruned by the market job).
