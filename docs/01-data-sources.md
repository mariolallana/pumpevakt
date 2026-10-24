# 01 · Data sources & feasibility (tested 2026-10-24)

> **Verdict:** **Feasible, with an honest split.**
> - ✅ **Market alarms (prices dropping or rising) work today on 100 % open data.** A daily Wholesale Diesel Index, backtested against 10 years of official pump prices, tracks the market well (correlation 0.92).
> - ✅ **Station list:** 158 stations around Oslo from open ODbL data.
> - ❌ **Live per-station prices:** no open source has fresh Oslo data today. The "best deal near me" and "cheap station" features are **gated** behind one of the unlocks in §4.

Re-run every test yourself: `node scripts/probe-sources.mjs` and `node scripts/backtest-wholesale.mjs`.

## 1. What we tested

| # | Source | Kind | Open? | Test result (2026-10-24) | Use |
|---|---|---|---|---|---|
| 1 | **Drivstoffpriser stations** `drivstoffpriser.github.io/…/data/stations.json` | Station list (name, brand, address, lat/lon) | ✅ ODbL | **OK:** 1,885 stations in Norway, 158 within 25 km of Oslo | **Station master data** |
| 2 | **Drivstoffpriser prices** `…/data/prices.json` | Crowd station prices, 12-hourly export | ✅ ODbL | **STALE:** 202 prices, newest 162 days old. Their live DB is also quiet since 2026-05-15 | Adapter ready, so the data revives automatically if the community does |
| 3 | **OpenStreetMap Overpass** | Station list | ✅ ODbL | **OK:** 173 stations, 0 with price tags | Backup station list |
| 4 | **FRED `DDFUELNYH`** (NY Harbor ULSD diesel, USD/gal) | Daily wholesale diesel | ✅ Public domain, keyless CSV | **OK:** 5.265 on 2026-10-20 (2–3 day lag) | **WDI input** |
| 5 | **FRED `DCOILBRENTEU`** (Brent crude) | Daily | ✅ Keyless CSV | **OK:** 115.22 on 2026-10-20 | Context line in messages |
| 6 | **Norges Bank EXR** (USD/NOK) | Daily FX | ✅ Open SDMX API | **OK:** 9.3509 on 2026-10-23 | **WDI input** |
| 7 | **SSB table 09654** | Monthly national pump average | ✅ NLOD, open API | **OK:** Sep 2026 diesel 27.52, 95 26.18 | Ground truth for the backtest, trend context |
| 8 | **OpenVan.camp** `/api/fuel/prices?country=NO` | National pump average, roughly weekly | ✅ Keyless | **OK:** diesel 27.22 (fetched 2026-10-17) | Pump-level confirmation of market moves |
| 9 | **Google Maps** (consumer UI, Oslo stations) | — | — | **No price section** shown on Oslo stations (Circle K Økern checked) | Strong hint that Places API won't have Norway either |
| 10 | **Google Places API (New) `fuelOptions`** | Station prices where Google has them | Paid SKU with a monthly free cap | **Not run yet**, because it needs your API key: `scripts/probe-google-places.mjs` (1 call) | Unlock candidate (§4) |
| 11 | **Chain websites** (Circle K, Uno-X, St1, Esso, YX, Best) | — | — | **No station prices published** (Esso blocks bots outright) | ❌ |
| 12 | **DrivstoffAppen API** | Station prices | ❌ Private | Closed since 2026-05 (v1 404, v3 401) | ❌ Don't touch. Partnership email only |
| 13 | Drivstoffprisene.no | Crowd station prices | ❌ Gated API | Live, but the API is protected | ❌ Partnership email only |

**Rule (unchanged):** only open data, written permission or our own reports. Never bypass auth, App Check, robots.txt or anti-bot measures.

## 2. The creative unlock: the Wholesale Diesel Index (WDI)

Norwegian pump price = **product cost** + road-use tax + CO₂ tax + margin + 25 % VAT. Taxes change rarely (budget dates), and margins swing intraday but average out. So day-to-day *market* moves are driven by the product cost, which is public:

```
WDI (NOK/L) = ULSD (USD/gal) ÷ 3.78541 × USD/NOK
```

**Backtest** (`scripts/backtest-wholesale.mjs`, 130 months, 2015-12 → 2026-09, against SSB official monthly diesel):

| Metric | Result | Meaning |
|---|---|---|
| Level correlation | **0.92** | WDI and pump price move together long-term |
| Monthly change, same month | **0.63** | Pump prices react within the *same month*, i.e. days, not months |
| Monthly change, pump one month later | 0.19 | Little extra lag beyond that month |
| Big WDI moves (> 0.5 NOK/L) | **38, of which 79 % moved the pump the same way that month** | Good enough for an alarm, especially with confirmation |

**Known blind spot:** tax and fee changes. In Sep 2026 the pump jumped +6.04 while WDI rose only +1.12, matching the reported fuel-tax policy swings. The alarm messages therefore always state "market cost signal". The weekly national pump average (OpenVan) is used as the confirmation and tax-change detector ([04](04-alert-engine.md)).

Daily resolution: FRED publishes US business days with about a 2-day lag, and Norges Bank publishes daily around 16:00 CET. That's fine for "the market is falling, wait a few days" or "it's rising, fill up now" decisions. It can't see Norway's intraday noon price jump, and doesn't need to.

## 3. Station prices: where they can come from

| Path | Effort | Coverage | Status |
|---|---|---|---|
| **A. Own reports** via Telegram `/p` (typed) and later a photo → AI extraction | Low | Only where I or friends drive | **MVP**. Useful for my own history and for friends |
| **B. Drivstoffpriser ODbL export** | Done (adapter) | Revives if their community does | Pulled every 12 h. Harmless when stale |
| **C. Google Places `fuelOptions`** | 2 min (create a key, run the probe) | Unknown, likely none in Norway | **Test it** (§4) |
| **D. Partnership** with DrivstoffAppen or Drivstoffprisene | One email each | Full | Emails pending (template below) |
| **E. Contribute our reports upstream** to Drivstoffpriser (ODbL, open source). Their writes require App Check from their own app, so this is done by *using their app* or opening a PR/API proposal in their repo | Social | Grows a shared open dataset | Optional, community-minded |

> **ODbL note:** if we ever *publish* a database derived from Drivstoffpriser or OSM data, it must be shared under ODbL too. For a personal app this doesn't trigger. Attribution is always shown.

## 4. Gates and unlocks

| Feature | Data needed | Gate |
|---|---|---|
| Market-drop / market-rise alarm | WDI + OpenVan | ✅ **Open now** |
| `/status`, trend chart | WDI, SSB, OpenVan | ✅ Open now |
| Station list and map | Drivstoffpriser stations | ✅ Open now |
| "Best deal near me" with live prices | Fresh station prices for ≥ 30 % of Oslo stations | 🔒 Unlocks with C or D, or B reviving |
| Cheap-station (outlier) alarm | Same | 🔒 Same gate. Until then it runs only on reports from A |

### Outreach email (send to post@drivstoffappen.no and the Drivstoffprisene contact)

> **Subject:** Read access for a personal, non-commercial Oslo fuel-alert app
>
> Hei! I'm building a small open-source app that alerts me (and a few friends) when diesel prices around Oslo drop or a station is unusually cheap. Would you consider giving read access to station prices for the Oslo area (~160 stations, polled every 30 min)? I'll credit you with a link in every alert, cache responsibly, and never resell or republish raw data. Happy to share our market-signal work (a wholesale-cost index that tracks pump prices with 0.92 correlation).
>
> Mvh, Mario Lallana · github.com/mariolallana

## 5. Domain facts

- Exclude **avgiftsfri diesel** (tax-free, illegal for road vehicles) everywhere.
- Prices include VAT. Tax changes cause structural steps, so treat them as information, not a "deal".
- The intraday jump (often around 12:00) is a known Norwegian pattern but **unverified by us**. It only matters once station-level data exists.
