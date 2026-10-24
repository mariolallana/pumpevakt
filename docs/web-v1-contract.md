# Web v1 · Shared contract (implementer ↔ QA)

This is a lean version of Phase 4, pulled forward so the user can see and test a UI. It derives from docs/04 §3, docs/05 §2 and docs/06 §2, and doesn't change the specs. Deviations and flaws go into the flaw files.

**Deliberate deviation (log it in `docs/spec-flaws-impl.md`):** the web app is served as **Workers static assets from the same Worker** instead of a separate Cloudflare Pages project. That keeps it to one deployable with the same origin, so no CORS setup is needed.

## Ownership
| Path | Owner |
|---|---|
| `web/**`, `src/**`, `wrangler.toml`, `package.json`, `vite`/`tsconfig` configs, `.github/workflows/**`, `test/unit/**` | Implementer |
| `test/qa/**`, `docs/qa-report-web-v1.md` | QA |
| `docs/spec-flaws-impl.md` (append under a "Web v1" heading) | Implementer |
| `docs/spec-flaws-qa.md` (append under a "Web v1" heading) | QA |
| `docs/00–10`, `docs/spec-flaws.md`, `CLAUDE.md`, `README.md`, `db/`, `scripts/`, contracts | **Nobody** |

## Scope
1. **API** (in the Worker, read-only, JSON, `Cache-Control: public, max-age=60`)
   - `GET /api/stations?lat=<n>&lon=<n>&radius_km=<n=10, max 30>&fuel=<diesel|petrol95|petrol98|hvo100, default diesel>`
   - `GET /api/market?days=<n=30, max 365>`
   - Bad params → `400 {"error":{"code":"BAD_INPUT","message":"..."}}`
2. **Web page** (`web/`, Vite + React + TypeScript + Tailwind v4, MapLibre GL + OpenFreeMap `liberty` tiles), built into `web/dist`. The Worker serves it via `[assets]`, and `/api/*` and `/health` go to the Worker first.
3. A single screen ("Find") per docs/06 §2 design tokens:
   - Fuel select (default diesel).
   - "📍 Near me" button: browser geolocation, fallback HOME. Ask for location only on tap.
   - Radius chips (5 / 10 / 20 km).
   - Oslo median card: level now, today's median, and the WDI line if available.
   - Map with price pills coloured by Δ vs the reference price. Tap a pin to highlight its row.
   - List sorted by net saving. Each row shows price (mono tabular figures), name, brand, distance, age, saving and a 🧭 Navigate link (Google Maps directions).
   - States: loading, empty ("No fresh prices within 10 km. Widen to 20 km?"), stale (> 6 h greyed, > 24 h excluded from the API), error/source-down banner (from `/health` `consecutiveFailures ≥ 2` or `lastOk` older than 2 h).
   - Footer attribution: "Prices: drivstoffapp.no · Map © OpenStreetMap contributors, OpenFreeMap".
   - Light and dark (prefers-color-scheme). Mobile-first: 375 px and 1440 px.

## Response shapes

```ts
// GET /api/stations
interface StationsResponse {
  fuel: Fuel;
  origin: { lat: number; lon: number };
  radiusKm: number;
  refPrice: number | null;   // docs/04 §3 "L": latest Oslo level for diesel; for other fuels or if missing, the median of fresh (≤6 h) prices in the radius
  generatedAt: string;       // ISO
  stations: Array<{
    id: string; name: string; brand: string; address: string; lat: number; lon: number;
    price: number;           // latest price for `fuel`
    observedAt: string;      // ISO
    ageMinutes: number;
    stale: boolean;          // age > 6 h
    distanceKm: number;      // 2 decimals
    netSavingNok: number | null; // docs/04 §3, rounded to integer; null if refPrice is null
  }>;                        // only prices ≤ 24 h old, sorted by netSavingNok desc (nulls last), then price asc
}

// GET /api/market
interface MarketResponse {
  days: number;
  osloDieselMedian: Array<{ day: string; value: number }>; // market_daily 'oslo_diesel_median', ascending
  wdi: Array<{ day: string; value: number }>;              // 'wdi_nok_l', ascending
  latest: { level: number | null; at: string | null; nFresh: number | null }; // from the latest ok prices run
}
```

Pure logic belongs in `src/core/` (e.g. `netSaving.ts` exporting `netSavingNok(refPrice, price, distanceKm, tankL, consumptionL100): number`, with detour `2 × km × 1.3`) and gets unit-tested. Route handlers stay thin.

## Non-goals (not in web v1)
Charts or history views, auth, Telegram, alarms, PWA/offline.
