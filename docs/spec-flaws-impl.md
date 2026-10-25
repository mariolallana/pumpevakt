# Spec flaws and gaps found during Phase 1 implementation

The implementer owns this log. The specs (docs/00–10) weren't edited. For each item: where it is, the problem, what the code does now, and a suggested spec fix.

## IMPL-1 · docs/02 §5 "CPU risk": response size is 2.6× the assumption
- **Problem:** docs/02 assumes about 3 × 100 KB of JSON per run. A real `radius=12&limit=100` response is **262 KB** (most of it the nested `expand` city/municipality/county/country objects), so a run parses about 790 KB. Measured on the dev machine (Node 20, `performance.now()`, real response × 3): `JSON.parse` plus `mapStations` takes **~4.4 ms warm and ~8 ms cold**. All pure work per run (parse, map, dedupe, changes, level, JSON for D1) takes **~5 ms warm and ~9 ms cold**. That's close to the 10 ms free-plan CPU limit. D1 and fetch wait time don't count as CPU.
- **Chosen:** no mitigation in Phase 1. The mapper avoids extra copies, and all DB writes are single statements (see IMPL-6).
- **Suggested spec fix:** change "~3 × 100 KB" to "~3 × 260 KB" and make "measure with `wrangler tail` on first deploy" a hard exit criterion. Write the fallback order down: (1) Workers Paid, $5/mo; (2) check whether the API supports a field filter or `expand` off, since `/docs` may list one; (3) 2 calls per run.

## IMPL-2 · docs/01 §2 / docs/02 §4: the three centres aren't specified
- **Problem:** the spec says "Oslo west, centre, east, radius 12 km each" with no coordinates. With 12 km circles, the centre call already hits `limit=100` at about 11.6 km. Three circles in a W–E line can't cover the whole 25 km "area" disc: the far north (Nordmarka, mostly forest) and south (the fjord / Nesodden) are left out.
- **Chosen:** `CENTRES` = west (59.92, 10.56, Lysaker/Bærum), centre (59.9111, 10.7528, Oslo S), east (59.93, 10.95, Furuset/Lørenskog). The live smoke run returned **150 unique stations** and 75 fresh diesel prices.
- **Suggested spec fix:** list the coordinates in docs/01 §2 and say the area is "approximately covered" (the coverage guard `n_fresh ≥ 30` protects the level).

## IMPL-3 · docs/04 "Daily level": how is "median of all L values that day" kept?
- **Problem:** the schema has no place for intraday `L` values, and `market_daily` stores only one value per day.
- **Chosen:** each successful prices run writes its `L` into `runs.detail.level`. The job then reads today's successful prices runs (Europe/Oslo date, from a 26 h UTC lookback), takes the median of their levels plus the current one in TypeScript, and upserts `market_daily(today, 'oslo_diesel_median')`. This is exact, adds no table, and costs one small read. It depends on `runs` being kept ≥ 1 day (it's kept 30). Runs with `L = null` (coverage guard) contribute nothing. If no run that day has a level, no row is written.
- **Suggested spec fix:** add to docs/03: "`runs.detail.level` holds each prices run's `L`; the daily median is recomputed from that day's runs."

## IMPL-4 · docs/05 §2 `/health` shape is only sketched
- **Problem:** `{ jobs: { prices: {lastOk, lastError, nFresh}, market: {…} } }` doesn't define the value types, "failures" (from docs/05 §1) or what market reports.
- **Chosen:** per job, `{ lastRun: {at, ok} | null, lastOk: ISO | null, lastError: {at, error} | null, consecutiveFailures, ...extras }`. The extras come from the newest successful run's detail: prices → `nFresh, nObs, level, dayMedian`; market → `nPoints, lastWdi`. A run that started but never finished (`ok` NULL, e.g. killed for CPU) counts as a failure.
- **Suggested spec fix:** copy this shape into docs/05 §2. `consecutiveFailures` is what Phase 2's "two failed runs in a row → ⚠️" needs.

## IMPL-5 · Job failure semantics (contract signatures vs "every run writes a runs row")
- **Problem:** the contract types `runPricesJob` and `runMarketJob` as returning counts, but doesn't say whether they throw on failure.
- **Chosen:** jobs **never throw**. On failure they write `runs.ok = 0` with `detail.error`, `console.error` it, and return zeros plus an extra `error: string` field (a backwards-compatible extension of the contract type). The `runs` row is inserted at the **start** (`ok` NULL) and updated at the end, so a run killed mid-way still leaves a trace. These count as failed runs: any HTTP error or timeout from any of the 3 centres (no partial runs, KISS), a non-array body, a non-empty array where nothing maps (renamed fields), all three centres empty, and FRED or Norges Bank returning no parseable rows. `scheduled()` uses `ctx.waitUntil`.
- **Suggested spec fix:** state this in docs/05 §3 and docs/09.

## IMPL-6 · Free-plan D1 limit on queries per invocation is not in docs/02 §5
- **Problem:** the Workers free plan allows only about 50 D1 queries per invocation, and each statement can bind at most 100 parameters. A naive per-row upsert (~150 stations plus ~450 prices on the first run) would go far over that.
- **Chosen:** bulk writes bind one JSON array and expand it with `json_each()`, so the whole prices run is **7 statements** whatever the row count. The "latest price per (station, fuel)" lookup uses the `(station_id, fuel, observed_at DESC)` index once per known pair instead of a full `GROUP BY` scan. A full scan would read about 150k rows × 48 runs a day after a year, which goes over the 5M reads/day free limit.
- **Suggested spec fix:** add "≤ 50 D1 queries per invocation, ≤ 100 bound params per statement" to the docs/02 §5 table.

## IMPL-7 · `Station.brand: string` vs real data
- **Problem:** 8 of 100 live stations have `"brand": null`. The contract's `Station.brand` is a non-null `string`, while the schema allows NULL.
- **Chosen:** use `brand` if present, otherwise `expand.chain.name`, otherwise `''`. Address falls back to `''` the same way.
- **Suggested spec fix:** say this in the docs/01 §2 mapping.

## IMPL-8 · `updated_at` timestamp format and `observed_at` canonical form
- **Problem:** the source gives `"2026-10-24 07:26:46.000Z"` (space, not `T`). Only "ISO" is specified for `observed_at`, and change detection compares strings.
- **Chosen:** normalise with `new Date(...).toISOString()`, giving `YYYY-MM-DDTHH:MM:SS.sssZ` always. A missing zone is read as UTC. Unparseable or missing per-fuel `updated_at` means the price is skipped.
- **Suggested spec fix:** say "`observed_at` = `Date.toISOString()` form" in docs/03.

## IMPL-9 · Price bounds and other source fields
- **Chosen:** keep prices in 5–60 inclusive, matching the schema `CHECK BETWEEN 5 AND 60`. Ignore `e10_price` (it isn't in the `Fuel` union). Stations with `closed: true` / `is_active: false` are **not** filtered yet (the spec doesn't mention it). The live data also has implausible values inside 5–60 (e.g. Esso Trondheimsveien petrol98 = 18.66, far below its own 95 at 27.70). These are stored as-is, and the docs/04 plausibility rule is only defined for the Phase 3 alarms.
- **Suggested spec fix:** decide in docs/01 §2 whether to drop `closed`/inactive stations. Consider applying the `0.6 × L` plausibility rule to `/near` (Phase 2) as well.

## IMPL-10 · Node 20 vs the current toolchain
- **Problem:** the contract says Node 20, but current wrangler (≥ 4.87), miniflare and vitest 5 require Node 22, and vite 7+ needs Node ≥ 20.19. The local Node is 20.18.0, and Node 20 has been EOL since April 2026.
- **Chosen:** pin a Node-20-compatible set: wrangler 4.86.0, miniflare 4.20260426.0, vitest 4.1.12 with an npm `overrides` of vite 6.4.5, typescript 5.9.3, @cloudflare/workers-types 4.20260426.1. CI uses Node 20. `npm install` warns that undici 7.24.8 wants Node ≥ 20.18.1, but everything works. `npm audit` reports dev-only advisories (esbuild dev server on Windows, sharp via miniflare). None of them are in the deployed Worker.
- **Suggested spec fix:** move the project to Node 22 LTS in docs/07 and bump the pins in one go.

## IMPL-11 · `src/index.ts` named exports
- **Problem:** the contract shows `export default { fetch, scheduled }` and nothing else. workerd rejects any non-handler named export from the entry module ("Incorrect type for map entry 'MARKET_CRON'"). I found this during the smoke run.
- **Chosen:** `src/index.ts` exports only the default. The routing, cron constants and `/health` live in `src/routes.ts`. A unit test guards this.
- **Suggested spec fix:** add one line to the contract: "the entry module must have no named exports."

## IMPL-12 · tsconfig strictness vs the QA suite
- **Chosen:** `strict: true` without `noUncheckedIndexedAccess`, so the QA suite (written against plain "strict") typechecks. `test/unit/env.d.ts` declares `ImportMeta.url` and `*.csv?raw` / `*.sql?raw`, so `@types/node` isn't needed.

## Not a flaw, noted for Phase 2
- The failure ping is a `TODO(phase 2)` in both jobs. `/health` already exposes `consecutiveFailures`.
- `runs` pruning (30 days) runs in the market job. If the market job keeps failing, pruning stops too. That's harmless at ~1.5k rows/month.

## Web v1

Implementer log for the lean web page (docs/web-v1-contract.md). The specs weren't edited.

### IMPL-W1 · Deliberate deviation: Workers static assets instead of Cloudflare Pages
- **Spec:** docs/06 §2, docs/07 and CLAUDE.md put the dashboard on Cloudflare Pages, calling the Worker's `/api/*`.
- **Chosen (per contract):** the Vite build (`web/dist`) is served as **Workers static assets from the same Worker**: `[assets] directory = "web/dist"`, `not_found_handling = "single-page-application"`, `run_worker_first = ["/api/*", "/health"]`. wrangler 4.86's config schema accepts the array form. The result is one deployable on one origin, with no CORS. No `ASSETS` binding is needed, because the Worker never serves files itself. An asset miss that isn't a navigation reaches the Worker's plain 404. `deploy.yml` runs `npm run build:web` before `wrangler deploy`, `ci.yml` builds it too, and `web/dist/` is gitignored. Static asset requests are free and don't use Worker CPU.
- **Suggested spec fix:** docs/02/06/07: "the web page is static assets of the same Worker".

### IMPL-W2 · `/api/stations` without `lat`/`lon` defaults to HOME
- **Problem:** the contract lists `lat`/`lon` as given and puts the "fallback HOME" in the browser. But the page doesn't know HOME (it's a wrangler var), and there's no config endpoint.
- **Chosen:** if both are missing, origin = `HOME_LAT/HOME_LON`, echoed in `origin`. If only one is given, 400. The page sends no coordinates until "📍 Near me" succeeds. On denial or timeout it says "Showing prices near home". No new endpoint.
- **Suggested spec fix:** add "lat/lon optional together; default HOME" to the contract and docs/05 §2.

### IMPL-W3 · Param validation semantics
- `radius_km` must be > 0 and ≤ 30 (decimals allowed). Above 30 is **400, not clamped**.
- `days` must be an integer from 1 to 365. Above 365 is 400.
- A param that is present but empty (`?lat=`) is 400.
- `fuel` is case-sensitive (`DIESEL` → 400).
- `lat` must be in [−90, 90] and `lon` in [−180, 180].
- Errors return `400 {"error":{"code":"BAD_INPUT","message"}}` with `Cache-Control: no-store`.
- Outside the contract, using the same JSON error shape: an unknown `/api/*` path → 404 `NOT_FOUND`; a method other than GET/HEAD → 405 `METHOD_NOT_ALLOWED`; a D1 failure → 500 `INTERNAL`.

### IMPL-W4 · refPrice takes the newest ok run's level regardless of its age
- **Problem:** "latest Oslo level" has no freshness bound. If the prices job stalls for a day, diesel savings are computed against a day-old `L`, while station prices may be newer.
- **Chosen:** the literal contract. I use the newest successful prices run (by `started_at`). If its `level` is null (coverage guard), the fallback is the median of fresh (≤ 6 h) prices in the radius, **not** an older non-null level. The page shows the source-down banner when `/health` reports `consecutiveFailures ≥ 2` or `lastOk` > 2 h, so a stall is still visible.
- **Suggested spec fix:** "use `L` only if its run is ≤ 2 h old, else fall back to the radius median".

### IMPL-W5 · Rounding, boundaries and sort details
- `distanceKm` is the haversine distance rounded to 2 decimals. `netSavingNok` is computed from that rounded value, so a client can reproduce it from the response. The radius filter uses the exact distance.
- `ageMinutes` is whole minutes, rounded down. `stale` means age **> 6 h**, so exactly 6 h counts as fresh. A row is included if age is **≤ 24 h**, so exactly 24 h is kept. A future `observed_at` (clock skew) counts as age 0.
- Sort order: `netSavingNok` (the rounded integer) desc with nulls last, then `price` asc, then `distanceKm` asc, then `id`. `netSavingNok` never returns `-0`.
- `/api/market?days=n` covers the last n Europe/Oslo calendar days **including today** (`day ≥ osloDate(now − (n−1) days)`). `latest.at` is the run's `finished_at`, the same value as `/health` `lastOk`. `level` and `nFresh` are read with `json_extract` in SQL, so the Worker does no JSON parsing.
- SQL: one correlated, index-backed "latest price for this fuel" lookup per active station inside a lat/lon box slightly larger than the circle, with `observed_at ≥ now − 24 h` applied in SQL. Haversine, median and ranking run in `src/core/stationList.ts`. Each `/api/*` request makes at most 3 D1 queries.

### IMPL-W6 · docs/06 §2 vs contract on stale rows
- **Problem:** docs/06 says "Stale prices (> 24 h) are greyed and never ranked". The contract says > 6 h is `stale` (greyed), > 24 h is excluded by the API, and the list is sorted purely by net saving. So a cheap price that is 20 h old can sit near the top.
- **Chosen:** the contract. Stale rows are greyed and labelled "stale · 16 h ago" in the alert colour, and their map pills are faded and dashed. They are still ranked.
- **Suggested spec fix:** decide whether stale rows should sink below fresh ones (a one-line change in `buildStations`).

### IMPL-W7 · Dependencies and versions (Node 20.18)
- All web packages are **devDependencies**: they're bundled at build time, and QA-PKG-04 forbids runtime deps.
  - react/react-dom 19.3.1
  - vite 6.4.5 (already the `overrides` pin)
  - @vitejs/plugin-react 4.7.0 (5+ needs Node ≥ 20.19)
  - tailwindcss + @tailwindcss/vite 4.3.3
  - maplibre-gl **5.24.0**
  - @fontsource/geist-sans + geist-mono 5.3.0 (latin subsets only, 5 weights in total)
  - @types/react and @types/react-dom 19.3.0
- **maplibre-gl 6.x was rejected.** It is ESM-only and loads its web worker from a separate `maplibre-gl-worker.mjs`, resolved against `import.meta.url` at runtime. A Vite bundle doesn't emit that file without extra `setWorkerUrl` wiring. 6.x also pulls in `@mapbox/jsonlint-lines-primitives`, which declares Node ≥ 22. 5.24 inlines its worker.
- shadcn/ui and Recharts (docs/06/07) aren't used. Charts are out of web v1 scope, and the few controls are plain Tailwind.
- `npm run typecheck` now also runs `tsc -p web/tsconfig.json` (DOM lib, react-jsx). The root `tsconfig.json` is unchanged.

### IMPL-W8 · Map density on a 375 px screen
- **Problem:** there are about 65 diesel stations within 10 km of HOME. On a phone, 65 price pills overlap into an unreadable blob.
- **Chosen:** full price pills (▼/▲ plus price) only for the **top 10 rows by net saving, plus the selected station**. All other stations are 20 px dots that still carry ▼/▲ (or • at the reference) and a full `aria-label`. Tapping a dot selects its row and turns it into a full pill. The list is the complete, accessible mirror of the map.

### IMPL-W9 · Attribution
- The footer uses the contract text verbatim, plus "Wholesale index: FRED · Norges Bank". The median card shows the WDI line built from those sources, and docs/06 §2 lists them. The MapLibre compact attribution control stays on the map and is collapsed after load.

### IMPL-W10 · Local dev gotchas (wrangler 4.86 + assets)
- `wrangler dev` needs `web/dist` to exist, so run `npm run build:web` first. When I rebuilt `web/dist` **while `wrangler dev` was running**, the dev asset server kept returning 404 for the rewritten files (index.html and the hashed JS) until I restarted it. Restart `wrangler dev` after each `build:web`, or for UI work use `npm run dev:web` (Vite on :5173, proxying `/api` and `/health` to :8787).
- With `not_found_handling = "single-page-application"`, `wrangler dev` treated `GET /__scheduled` as a navigation and returned index.html. To trigger crons locally, send `-H "Sec-Fetch-Mode: cors"`, e.g. `curl -H "Sec-Fetch-Mode: cors" "http://127.0.0.1:8787/__scheduled?cron=*/30+*+*+*+*"`. Production is unaffected, because `/__scheduled` doesn't exist there.

### Web v1 · fix round after QA (docs/qa-report-web-v1.md)

### IMPL-W11 · Privacy: `/api/stations` without lat/lon defaults to Oslo S, never HOME (supersedes IMPL-W2, fixes QA-BUG-W7)
- **Problem:** IMPL-W2 echoed `HOME_LAT/HOME_LON` in `origin` on a public, unauthenticated endpoint, which breaks docs/05 §2 "no personal data".
- **Chosen:** if both coordinates are missing, origin = **Oslo S (59.9111, 10.7528)** (`OSLO_S` from `src/core/geo.ts`). Only one coordinate → 400, as before. HOME is no longer read by any `/api/*` handler, and it never appears in the web bundle. The page's default view is "Near Oslo S", and "📍 Near me" uses browser geolocation. On denial or failure the page says "Showing prices near Oslo S". HOME stays in `wrangler.toml` for the Phase 2 bot (`/near`).
- **QA test now in conflict:** `QA-API-V-22` accepts only `400` or `origin == HOME (59.93, 10.8)`. It now gets `200` with `origin == Oslo S`, which is the coordinator's privacy decision. That assertion should become `origin == {lat: 59.9111, lon: 10.7528}`, or "not HOME".
- **Suggested spec fix:** docs/05 §2 / contract: "lat/lon optional together; default Oslo S; HOME is never exposed by the API".

### IMPL-W12 · Ranking: fresh before stale (deliberate deviation from the contract sort; addresses QA-SPEC-W1 / UX-2)
- **Contract:** sort by `netSavingNok` desc (nulls last), then price asc.
- **Chosen (coordinator decision):** **fresh rows (≤ 6 h) always come before stale rows (6–24 h)**. Within each group the order is `netSavingNok` desc (nulls last), then `price` asc, then `distanceKm` asc, then `id`. An old cheap price can no longer sit above a fresh recommendation. This lives in `buildStations` (`src/core/stationList.ts`) and is unit-tested. The QA sort tests still pass, because in their fixtures the stale rows were already last.
- **Suggested spec fix:** put this sort into the contract / docs/06 §2.

### IMPL-W13 · UI fixes from the QA round
- **QA-BUG-W3 (distance cut off at 375 px):** the sub-line is now `distance · brand`. The distance is a non-shrinking element, and only the brand may truncate. The brand is dropped when the station name already contains it ("Circle K Kalbakken"). Long names truncate on their own line. Age has stayed in the right-hand column since QA-BUG-W2.
- **QA-BUG-W4 (stale contrast):** no more `opacity`. In stale rows, the price, name, delta and saving use `--ink-muted` (5.87:1 light), and the "stale · 16 h ago" label keeps `--alert`. Stale map pills are now `--surface` with `--ink-muted` text and a dashed `--ink-muted` border (≥ 5.8:1), still with ▼/▲.
- **QA-BUG-W5:** in dark mode the neutral ("at Oslo average") pill gets dark text `#0E1112` on `#9AA3A5` (7.4:1), like the cheap and pricey pills.
- **QA-BUG-W9:** in the error state the heading reads "Stations within N km" with no count. The comparison price and the savings note are hidden.
- **Above the fold (UX-1):**
  - The median card is now one line: "Oslo average **24.65** · today 24.65 · wholesale ▲0.17 · 4 min ago". The full sentence, with the WDI value and date, is in the card's `aria-label` and in tooltips.
  - The mobile map is `30vh` (min 200 px) instead of `42vh`.
  - At 375×812 the first station row ends at y ≈ 638 px.
- **Wording (UX-3/4):** "ref" is gone. The list header says "vs Oslo average 24.65", or "vs average nearby" when the reference is the radius median. The row delta's accessible text is "x.xx below/above Oslo average". A delta at exactly the reference shows "= avg".
- **CI:** `ci.yml` and `deploy.yml` now run `npm run build:web` **before** `npm test`, so QA's bundle checks (QA-WEB-DIST-*) run in CI.
- **Not changed in this round:** QA-BUG-W6 (map tap targets < 44 px; the list is the accessible mirror) and QA-BUG-W8 (visible text label next to ▼/▲ in rows). UX-5…10 are also left as they are.

### IMPL-W14 · Correction to IMPL-W10: the "stale assets" were an orphaned `workerd` (Windows), not wrangler caching
- **Finding:** on Windows, stopping `npx wrangler dev` can leave its `workerd.exe` child running and **still listening on :8787**. Windows lets a second `wrangler dev` bind the same port too, so requests were answered by whichever process won. That was the old one, with the previous build's asset manifest. That explains the 404s for `/` and the hashed JS, and the inconsistent `/__scheduled` behaviour. After killing the orphans (`Get-NetTCPConnection -LocalPort 8787 -State Listen` → `Stop-Process`), a fresh `wrangler dev` served the new build correctly.
- **Chosen:** `run_worker_first` now also lists `"/__scheduled"`, so `wrangler dev --test-scheduled` cron triggers always reach the Worker and never the SPA fallback. Plain `curl "http://127.0.0.1:8787/__scheduled?cron=*/30+*+*+*+*"` works with no extra header. In production `/__scheduled` is just a Worker 404. The `Sec-Fetch-Mode` header workaround in IMPL-W10 is withdrawn.
- **Dev tip:** if the page 404s after a rebuild, check for more than one listener on :8787.

### IMPL-W15 · Rough pump estimate for the chart's days before recording (owner decision 2026-10-25)
- **Problem:** pump prices are only recorded from 23 Oct, so 27 of the 30 chart days were empty. No open source has past station prices: drivstoffapp.no returns only each station's latest price, and its trend endpoint returns a word, not data.
- **Chosen (owner, after being told the error size):** on those days a dashed grey line shows `WDI (latest published on or before the day) + gap`. The gap is the median of (recorded daily level − WDI) over our recorded days, recomputed on every request. It is `src/core/estimate.ts`, returned as `estimate` by `/api/outlook` (diesel only).
- **Limits, shown in the UI:** ±3–5 kr. The SSB backtest's pump−WDI gap moved 10.6–15.8 kr between months in 2026, and the estimate has no daily cycle. It is display only: never stored as prices and never used by the verdict, the normal level or alarms. Each day it is replaced as real data arrives, so it disappears by about 22 Nov.
- **Suggested spec fix:** docs/06 history chart: "days before recording may show a labelled rough estimate".
