# 01 · Data sources (open endpoints only, tested 2026-10-24)

> **Verdict: fully feasible with public, keyless endpoints.** No partnerships, no paid APIs, no API keys.
> - **Station prices:** `backend.drivstoffapp.no`, a public documented API. **95 of 100** stations within 25 km of Oslo had a diesel price under 24 h old, and 57 under 6 h.
> - **Market context:** FRED + Norges Bank → Wholesale Diesel Index (0.92 correlation with official pump prices over 10 years).

Re-run any time: `node scripts/probe-sources.mjs` and `node scripts/backtest-wholesale.mjs`.

## 1. The sources we use (the whole list)

| Role | Source | Endpoint | Key? | Tested |
|---|---|---|---|---|
| **Station prices (primary)** | Drivstoffapp V2 API, public, docs at [backend.drivstoffapp.no/docs](https://backend.drivstoffapp.no/docs) | `GET /stations/fuel/nearby?lat&lng&radius&limit&include_no_price=false` | No | ✅ 100 stations, 95 with diesel < 24 h, Oslo median 24.33, range 22.85–28.34 |
| Station prices (backup) | Drivstoffpriser open data (ODbL) | `drivstoffpriser.github.io/Drivstoffpriser-App/data/prices.json` | No | ⚠️ Stale (newest 162 days). Kept as a free fallback |
| Station list (backup) | Drivstoffpriser `stations.json` (ODbL) / OpenStreetMap Overpass | see `scripts/probe-sources.mjs` | No | ✅ 158 / 173 Oslo stations |
| Wholesale diesel | FRED `DDFUELNYH` (NY Harbor ULSD) | `fred.stlouisfed.org/graph/fredgraph.csv?id=DDFUELNYH` | No | ✅ daily, ~2-day lag |
| FX | Norges Bank | `data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=csv` | No | ✅ daily |
| Official monthly average | SSB table 09654 | `data.ssb.no/api/v0/no/table/09654` | No | ✅ (for backtest and trend only) |

**Rejected:**
- Google Places: not open (a billed API with a key) and Google Maps shows no fuel prices in Oslo.
- HERE and TomTom: commercial.
- Chain websites: they publish no station prices.
- The old DrivstoffAppen mobile API: closed, and it was never public.
- Drivstoffprisene.no: gated.

## 2. Using the Drivstoffapp API responsibly

It's public and documented, but it's a community service with **no published terms or uptime promise**. So:

- **Poll gently:** every 30 min, 3 requests per run, i.e. about 150 requests/day. `limit` maxes out at 100, so we query three centres (Oslo west, centre, east, radius 12 km each) and dedupe by station `id`.
- Send an honest `User-Agent: pumpevakt/1.0 (github.com/mariolallana/pumpevakt)`.
- Use only the unauthenticated **read** endpoints. Never the `auth`-marked ones.
- **Attribute it** in every bot message footer and on the dashboard: "Prices: drivstoffapp.no".
- **Plan for it to change:** the adapter has a recorded fixture and test. If it fails 2 runs in a row → Telegram ⚠️, and `/near` falls back to the last known prices with their age shown. Market alarms keep working from FRED and Norges Bank regardless.

### Response fields we map (from the live response)

```jsonc
{
  "id": "j1i4da8bf8wkcql", "name": "Fredensborg", "brand": "Uno X",
  "location": { "latitude": 59.9208, "longitude": 10.7511, "address": "Maridalsveien 10, 0178 Oslo" },
  "prices": {
    "diesel_price": 24.77, "gasoline_price": 25.75, "octane_price": 25.95, "hvo100_price": null,
    "fd_price": null,                     // tax-free diesel → always ignored
    "updated_at": { "diesel_price": "2026-10-24 07:26:46.000Z", "gasoline_price": "…", "octane_price": "…" }
  }
}
```

Mapping: `diesel_price` → `diesel`, `gasoline_price` → `petrol95`, `octane_price` → `petrol98`, `hvo100_price` → `hvo100`. The per-fuel `updated_at` becomes `observed_at`.

## 3. Wholesale Diesel Index (WDI): the market early-warning

```
WDI (NOK/L) = ULSD (USD/gal) ÷ 3.78541 × USD/NOK
```

Backtest (`scripts/backtest-wholesale.mjs`, 130 months, compared with SSB official diesel):
- Level correlation **0.92**.
- Same-month change correlation **0.63**.
- On the 38 big moves, pump prices went the same direction **79 %** of the time.

Blind spot: tax changes (Sep 2026: pump +6.04, WDI +1.12). That's why WDI is only the *early-warning context line*. The alarm itself is driven by the real Oslo station prices ([04](04-alert-engine.md)).

## 4. Domain notes
- Exclude tax-free diesel (`fd_price`) everywhere.
- Prices include VAT. Tax changes cause structural steps, so the alarm wording reflects that.
- We can now verify the intraday pattern (prices jump once a day, often around 12:00) with our own data after ~4 weeks. Until then it's not used.
