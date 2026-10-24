# 01 · Data sources & risk

> **TL;DR:** Norway has no official, open, station-level fuel-price feed. The unofficial DrivstoffAppen API that hobby projects relied on **was closed in 2026**. So the app is built around a **pluggable source-adapter layer**, and Phase 0 of the build is a go/no-go spike to secure at least one legitimate station-level source. Everything downstream (DB, alerts, UI) is source-agnostic.

## 1. Findings (researched 2026-10-24)

| Source | Granularity | Access | Status | Verdict |
|---|---|---|---|---|
| **DrivstoffAppen** (`api.drivstoffappen.no`) | ~4,000 stations, per-fuel price, `lastUpdated` | Was an undocumented mobile-app API (`/api/v1`, dynamic session token) | **Closed.** `/api/v1/*` returns 404 since ~2026-05-26. `/api/v3/*` returns 401 with no public session endpoint (source: the open-source [Pumperly scraper notes](https://github.com/GeiserX/Pumperly/blob/main/src/scrapers/norway.ts), checked 2026-09-21) | ❌ Do not reverse-engineer. ✅ **Ask for licensed access** (see §4) |
| **Drivstoffprisene.no** | Crowd-sourced, per station, per fuel, with timestamps | Has an internal `/api/stasjoner`, gated by build token, shared secret and bot detection | Live, "free and open for all" to *view* | ❌ No scraping or impersonation. ✅ **Ask for access**: small community project, likely receptive |
| **SSB table 09654** ([data.ssb.no](https://data.ssb.no/api/v0/en/table/09654)) | National **monthly** average, 95 and diesel, since 1986 | Official open API (PxWeb, JSON-stat2), no key | Live, verified | ✅ Use for long-term context only (trend page, sanity bounds). Not usable for alerts |
| **Chain sites/apps** (Circle K, Uno-X/YX, Esso, St1, Best) | Per station (inside their own apps) | No public API found. Check the terms per chain | Unknown | 🔍 Phase 0: check each chain for a public station-price page or partner programme |
| **Own crowd input** (me + friends via app or Telegram photo) | Per station, when someone passes by | Fully ours | Buildable | ✅ Always available fallback. Low coverage unless several people contribute |
| Aggregators (globalpetrolprices, dailyfuels, fuel-prices.eu) | National average, weekly | Mixed, often paid | — | ❌ Not useful |

**Rule for this project:** only use sources we're allowed to use (public open data, written permission or licence, or our own users' input). Never bypass auth, tokens, robots.txt or anti-bot measures. That keeps the app legal, stable and shareable later.

## 2. Strategy: adapters plus a source ladder

```
           ┌────────────────────────────┐
           │  SourceAdapter interface   │  fetch() → NormalizedObservation[]
           └────────────┬───────────────┘
   ┌────────────┬───────┴──────┬────────────────┬──────────────┐
 partner_api   chain_<x>     crowd           ssb_monthly     mock
 (licensed)   (if allowed)  (app/Telegram)  (context only)  (dev & tests)
```

Priority ladder (best first). The app works at every rung, just with less coverage:

1. **Licensed partner feed** (DrivstoffAppen or Drivstoffprisene). Full Oslo coverage, near-real-time. Every feature works.
2. **Chain-published prices**, where allowed. Good coverage for the discount chains (Uno-X, YX), which drive most outliers.
3. **Crowd input** from me and friends: photo of the price sign → AI extraction → 1-tap confirm. Coverage is sparse, but the outlier alarm still works for stations we pass.
4. **SSB monthly** feeds the trend page and the "is this price plausible" bounds.

`mock` adapter: generates a realistic Oslo dataset (≈120 stations, intraday price cycle, random outliers). It lets the whole app, including alerts, be built and demoed **before** Phase 0 resolves. **Build this first.**

## 3. Normalised observation contract

Every adapter returns this shape. Full TypeScript in [05](05-api-spec.md#4-source-adapter-contract).

```ts
type NormalizedObservation = {
  source: 'partner_x' | 'chain_unox' | 'crowd' | 'mock' | string;
  sourceStationId: string;     // id in the source system
  station?: {                  // present when the source knows station metadata
    name: string; brand: string; address?: string;
    lat: number; lon: number;
  };
  fuel: 'diesel' | 'petrol95' | 'petrol98' | 'hvo100';
  priceNok: number;            // per litre, incl. VAT, 2 decimals
  observedAt: string;          // ISO-8601. When the PRICE was set or seen, not when we fetched it
  confidence: number;          // 0..1  (partner 0.95, chain 0.99, crowd 0.6→0.9 after confirmations)
};
```

Station matching across sources: match by `(brand, distance < 75 m)` and store `station_source_ids` mappings ([03](03-data-model.md)). Station master data (names, coordinates, brands) can also be seeded from **OpenStreetMap** (`amenity=fuel` around Oslo via Overpass API, ODbL licence, attribution required). That gives us a station list even when the price source has none.

## 4. Phase 0 actions (go/no-go, ≤ 1 week)

1. **Email DrivstoffAppen AS** and **Drivstoffprisene** asking for personal, non-commercial API access (template below).
2. Check each chain (Uno-X, YX, Circle K, Esso, St1, Best) for a public station-price page, open data or terms that allow reading it. Record the result in the table above.
3. Seed Oslo stations from OSM Overpass (`amenity=fuel` within 30 km of Oslo S, about 59.9111, 10.7528).
4. **Decision:**
   - Rung 1 or 2 secured → build the full MVP.
   - Only rung 3 → build the MVP with crowd input promoted from v1 into MVP, and invite 3–5 Oslo friends to the Telegram bot.

### Outreach email template

> **Subject:** API access request for a personal, non-commercial fuel-price alert app (Oslo)
>
> Hei! I'm building a small personal app that alerts me (and a handful of friends) when diesel prices around Oslo drop or a station is unusually cheap. I'd love to use your data rather than build yet another crowd-sourcing app. Would you consider giving me read access to station prices for the Oslo area (about 150 stations, polled every 20–30 min)? I'll credit you prominently with a link in the app, cache responsibly, and never resell or republish the raw data. Happy to share anything useful the app finds (e.g. outlier-detection logic).
>
> Mvh, Mario Lallana · github.com/mariolallana

## 5. Known domain facts to design for

- **Intraday cycle.** Norwegian pump prices typically jump sharply once a day (often around midday) and then drift down until the next jump. Some weekdays are cheaper than others. ⚠️ Treat this as a hypothesis and verify it with our own data once ~4 weeks are collected. The alert engine compares **like-for-like** (same hour-of-week band) for exactly this reason ([04](04-alert-engine.md)).
- Prices include VAT and road-use tax. Tax changes (1 January, budget changes) cause *structural* step changes. The market-drop alarm must tag these ("likely tax change") rather than call them a bargain.
- **Avgiftsfri diesel** (tax-free, for farm or machinery use) is cheaper but illegal in road vehicles. **Exclude it** from all rankings and alerts.
