# Unit tests (implementer)

`npm test` runs everything under `test/**/*.test.ts`, so both this folder and the QA suite in `test/qa/` run. Nothing hits the network.

| File | Covers |
|---|---|
| `core.test.ts` | `geo`, `stats.median`, `osloLevel`, `computeWdi`, `osloDate`, `changedObs`, `jobHealth`, `loadConfig` |
| `sources.test.ts` | `mapStations` / `dedupeObs` / `fetchDrivstoffapp`, `parseFredCsv` / `fetchFred`, `parseNorgesBankCsv` / `fetchUsdNok`, all run on recorded fixtures with an injected fetch |
| `jobs.test.ts` | `runPricesJob`, `runMarketJob`, `scheduled()` dispatch, `GET /health`, and the entry-module export shape |
| `netSaving.test.ts` | Web v1: `netSavingNok` (docs/04 §3) and `buildStations` (24 h cut, 6 h stale flag, radius, refPrice fallback, sort) |
| `api.test.ts` | Web v1: `GET /api/stations` and `GET /api/market` against real local D1 (latest price per station, refPrice from the newest ok run, 400 `BAD_INPUT` cases, `Cache-Control`, 404/405/500) |

## D1 in tests: Miniflare, not vitest-pool-workers

The job tests use a **real, in-memory D1 from Miniflare** (`new Miniflare({ d1Databases: ['DB'] })` → `mf.getD1Database('DB')`), called from ordinary Node vitest. `db/migrations/0001_init.sql` is applied first (see `helpers.ts`).

Why:
- The SQL runs for real (json_each bulk upserts, the latest-price lookup, `RETURNING`), with no hand-written fake that could drift from SQLite.
- Every test stays in the default Node pool, so the QA suite runs unchanged in the same `vitest run`. `@cloudflare/vitest-pool-workers` would move all tests into workerd and pin vitest to a narrow version range.
- `miniflare` is already a transitive dependency of `wrangler`. It's pinned explicitly, at the same version wrangler 4.86.0 uses.

Each test file starts one Miniflare instance (about 1 s on Windows) and empties the tables before each test.

## Fixtures (recorded live on 2026-10-24 with the project User-Agent)
- `fixtures/drivstoffapp-nearby.json`: 15 stations from `GET /stations/fuel/nearby?lat=59.9111&lng=10.7528&radius=12&limit=100&include_no_price=false`, trimmed from 100 but kept in the real shape (nested `expand`, `fd_price`, null brands, missing diesel). It maps to 45 observations: 13 diesel, 15 petrol95, 9 petrol98 and 8 hvo100.
- `fixtures/fred-ddfuelnyh.csv`: `fredgraph.csv?id=DDFUELNYH&cosd=2026-09-01`. That's 36 rows, and 2026-09-07 is blank (Labor Day).
- `fixtures/norgesbank-usdnok.csv`: `EXR/B.USD.NOK.SP?format=csv&lastNObservations=30&locale=en`, 30 rows.

To re-record, rerun the same URLs with `User-Agent: pumpevakt/1.0 (github.com/mariolallana/pumpevakt)`, then update the counts asserted in `sources.test.ts`.
