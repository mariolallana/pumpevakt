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
