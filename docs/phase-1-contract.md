# Phase 1 · Shared code contract (implementer ↔ QA)

This is a working agreement for Phase 1, so implementation and QA can proceed in parallel. It *derives from* the specs (docs/00–10) and doesn't change them. Any spec flaw or gap goes into the flaw files, never into docs/00–10.

## Ownership (do not edit the other side's files)
| Path | Owner |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.toml`, `db/migrations/`, `src/**`, `test/unit/**`, `.github/workflows/**` | Implementer |
| `test/qa/**` (tests + their own fixtures), `docs/qa-report-phase-1.md` | QA |
| `docs/spec-flaws-impl.md` | Implementer |
| `docs/spec-flaws-qa.md` | QA |
| `docs/00–10`, `CLAUDE.md`, `README.md`, `db/schema.sql`, `scripts/` | **Nobody (read-only)** |

## Tooling
- Node 20, npm, TypeScript strict, ESM (`"type": "module"`).
- Vitest picks up `test/**/*.test.ts`, so both `test/unit` and `test/qa` run with `npm test`.
- Scripts: `npm test`, `npm run typecheck` (`tsc --noEmit`).
- Tests never hit the network. Live calls only happen in the probe scripts or when an agent is explicitly recording fixtures.

## Module contract (exact paths and exported names)

```ts
// src/types.ts
export type Fuel = 'diesel' | 'petrol95' | 'petrol98' | 'hvo100';
export interface Station { id: string; name: string; brand: string; address: string; lat: number; lon: number }
export interface StationObs { station: Station; fuel: Fuel; price: number; observedAt: string } // observedAt ISO-8601 UTC ('...Z')
export interface MarketPoint { day: string; series: string; value: number } // day 'YYYY-MM-DD'

// src/core/geo.ts
export const OSLO_S: { lat: number; lon: number };            // 59.9111, 10.7528
export function haversineKm(a: {lat:number;lon:number}, b: {lat:number;lon:number}): number;

// src/core/stats.ts
export function median(xs: number[]): number | null;           // null for empty input

// src/core/osloLevel.ts  (docs/04 shared definitions)
export interface OsloLevel { median: number; nFresh: number }
export function osloLevel(obs: StationObs[], now: Date, opts?: { fuel?: Fuel; radiusKm?: number; freshHours?: number; minFresh?: number }): OsloLevel | null;
// defaults: fuel 'diesel', radiusKm 25 (from OSLO_S), freshHours 6, minFresh 30; returns null if nFresh < minFresh

// src/core/wdi.ts  (docs/01 §3)
export function computeWdi(ulsd: MarketPoint[], usdnok: MarketPoint[]): MarketPoint[];
// series 'wdi_nok_l', value = ulsd/3.78541*usdnok, for each ULSD day using the USD/NOK on that day or the latest earlier day

// src/sources/drivstoffapp.ts  (docs/01 §2)
export const CENTRES: { lat: number; lon: number }[];          // 3 centres, radius 12 km each
export function mapStations(json: unknown): StationObs[];       // pure; ignores fd_price, null prices, missing updated_at
export function dedupeObs(lists: StationObs[][]): StationObs[]; // dedupe by station.id+fuel
export async function fetchDrivstoffapp(fetchFn?: typeof fetch, signal?: AbortSignal): Promise<StationObs[]>;

// src/sources/fred.ts
export function parseFredCsv(csv: string, series: string): MarketPoint[]; // skips '.' and blank values
export async function fetchFred(seriesId: string, series: string, fetchFn?: typeof fetch): Promise<MarketPoint[]>;

// src/sources/norgesBank.ts
export function parseNorgesBankCsv(csv: string): MarketPoint[];   // series 'usdnok'
export async function fetchUsdNok(fetchFn?: typeof fetch): Promise<MarketPoint[]>;

// src/jobs/prices.ts / src/jobs/market.ts
export async function runPricesJob(env: Env, deps?: { fetchFn?: typeof fetch; now?: Date }): Promise<{ nObs: number; nChanges: number; level: OsloLevel | null }>;
export async function runMarketJob(env: Env, deps?: { fetchFn?: typeof fetch; now?: Date }): Promise<{ nPoints: number }>;

// src/index.ts
export default { fetch, scheduled }; // scheduled dispatches: '*/30 * * * *' → prices, '30 6 * * *' → market; every run writes a `runs` row
```

`Env` has at least `DB: D1Database`. Jobs must be testable with the D1 binding from `@cloudflare/vitest-pool-workers` *or* with an injected fake. The implementer documents which in `test/unit/README.md`.
