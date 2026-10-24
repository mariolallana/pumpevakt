// D1 access. SQL only stores and reads; decisions (what changed, medians) live in TypeScript.
//
// Bulk writes pass one JSON array as a single bound parameter and expand it with json_each(), so each
// write is ONE statement regardless of row count. This keeps every run far below D1's per-invocation
// query limit (50 on the Workers free plan) and the 100-bound-parameters-per-statement limit.
import type { MarketPoint, Station, StationObs } from './types';

export type Job = 'prices' | 'market';

export interface LatestPrice {
  price: number;
  observedAt: string;
}

export const priceKey = (stationId: string, fuel: string): string => `${stationId}|${fuel}`;

export async function upsertStations(db: D1Database, stations: Station[]): Promise<void> {
  if (stations.length === 0) return;
  await db
    .prepare(
      `INSERT INTO stations (id, name, brand, address, lat, lon, active)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.name'), json_extract(value, '$.brand'),
              json_extract(value, '$.address'), json_extract(value, '$.lat'), json_extract(value, '$.lon'), 1
       FROM json_each(?1) WHERE true
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, brand = excluded.brand, address = excluded.address,
         lat = excluded.lat, lon = excluded.lon, active = 1`,
    )
    .bind(JSON.stringify(stations))
    .run();
}

/**
 * Latest stored price per (station, fuel), keyed by priceKey(). "Latest" = newest observed_at (ties: highest id).
 * Uses the prices_station_fuel_time index: one indexed lookup per known (station, fuel) pair, never a full scan.
 */
export async function latestPrices(db: D1Database): Promise<Map<string, LatestPrice>> {
  const { results } = await db
    .prepare(
      `WITH pairs AS (
         SELECT s.id AS sid, f.column1 AS fuel
         FROM stations s, (VALUES ('diesel'), ('petrol95'), ('petrol98'), ('hvo100')) f
       ),
       latest AS (
         SELECT (SELECT p.id FROM prices p WHERE p.station_id = pairs.sid AND p.fuel = pairs.fuel
                 ORDER BY p.observed_at DESC, p.id DESC LIMIT 1) AS pid
         FROM pairs
       )
       SELECT p.station_id, p.fuel, p.price, p.observed_at FROM latest JOIN prices p ON p.id = latest.pid`,
    )
    .all<{ station_id: string; fuel: string; price: number; observed_at: string }>();
  const m = new Map<string, LatestPrice>();
  for (const r of results) m.set(priceKey(r.station_id, r.fuel), { price: r.price, observedAt: r.observed_at });
  return m;
}

export async function insertPrices(db: D1Database, obs: StationObs[], source = 'drivstoffapp'): Promise<void> {
  if (obs.length === 0) return;
  const rows = obs.map((o) => ({ s: o.station.id, f: o.fuel, p: o.price, t: o.observedAt }));
  await db
    .prepare(
      `INSERT INTO prices (station_id, fuel, price, observed_at, source)
       SELECT json_extract(value, '$.s'), json_extract(value, '$.f'), json_extract(value, '$.p'),
              json_extract(value, '$.t'), ?2
       FROM json_each(?1)`,
    )
    .bind(JSON.stringify(rows), source)
    .run();
}

export async function upsertMarket(db: D1Database, points: MarketPoint[]): Promise<void> {
  if (points.length === 0) return;
  await db
    .prepare(
      `INSERT INTO market_daily (day, series, value)
       SELECT json_extract(value, '$.day'), json_extract(value, '$.series'), json_extract(value, '$.value')
       FROM json_each(?1) WHERE true
       ON CONFLICT (day, series) DO UPDATE SET value = excluded.value`,
    )
    .bind(JSON.stringify(points))
    .run();
}

/** Insert a runs row at the start (ok = NULL), so a run killed mid-way still leaves a trace. Returns its id. */
export async function startRun(db: D1Database, job: Job, startedAt: string): Promise<number> {
  const row = await db
    .prepare(`INSERT INTO runs (job, started_at) VALUES (?1, ?2) RETURNING id`)
    .bind(job, startedAt)
    .first<{ id: number }>();
  if (!row) throw new Error('runs insert returned no id');
  return row.id;
}

export async function finishRun(db: D1Database, id: number, ok: boolean, detail: unknown, finishedAt: string): Promise<void> {
  await db
    .prepare(`UPDATE runs SET finished_at = ?2, ok = ?3, detail = ?4 WHERE id = ?1`)
    .bind(id, finishedAt, ok ? 1 : 0, JSON.stringify(detail))
    .run();
}

/** Best-effort failure row: update the started row, or insert a fresh one if starting failed. Never throws. */
export async function recordFailure(
  db: D1Database,
  runId: number | null,
  job: Job,
  startedAt: string,
  detail: Record<string, unknown>,
  finishedAt: string,
): Promise<void> {
  try {
    const id = runId ?? (await startRun(db, job, startedAt));
    await finishRun(db, id, false, detail, finishedAt);
  } catch (e2) {
    console.error(`${job}: could not write failed runs row: ${e2 instanceof Error ? e2.message : String(e2)}`);
  }
}

/** Successful prices runs started at or after `sinceIso`, with their parsed detail. */
export async function recentOkPriceRuns(db: D1Database, sinceIso: string): Promise<{ startedAt: string; detail: Record<string, unknown> }[]> {
  const { results } = await db
    .prepare(`SELECT started_at, detail FROM runs WHERE job = 'prices' AND ok = 1 AND started_at >= ?1`)
    .bind(sinceIso)
    .all<{ started_at: string; detail: string | null }>();
  return results.map((r) => ({ startedAt: r.started_at, detail: safeJson(r.detail) }));
}

export async function pruneRuns(db: D1Database, beforeIso: string): Promise<number> {
  const res = await db.prepare(`DELETE FROM runs WHERE started_at < ?1`).bind(beforeIso).run();
  return res.meta.changes ?? 0;
}

export interface RunRow {
  id: number;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  ok: number | null;
  detail: Record<string, unknown>;
}

export async function recentRuns(db: D1Database, job: Job, limit = 50): Promise<RunRow[]> {
  const { results } = await db
    .prepare(`SELECT id, job, started_at, finished_at, ok, detail FROM runs WHERE job = ?1 ORDER BY id DESC LIMIT ?2`)
    .bind(job, limit)
    .all<{ id: number; job: string; started_at: string; finished_at: string | null; ok: number | null; detail: string | null }>();
  return results.map((r) => ({
    id: r.id,
    job: r.job,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    ok: r.ok,
    detail: safeJson(r.detail),
  }));
}

function safeJson(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    const v: unknown = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Latest price for `fuel` per active station inside a lat/lon box, newer than `sinceIso` (web v1 /api/stations).
 * One indexed lookup per station (prices_station_fuel_time), ~150 stations, never a full prices scan.
 */
export async function latestStationPrices(
  db: D1Database,
  fuel: string,
  sinceIso: string,
  box: { minLat: number; maxLat: number; minLon: number; maxLon: number },
): Promise<Array<{ id: string; name: string; brand: string | null; address: string | null; lat: number; lon: number; price: number; observedAt: string }>> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.name, s.brand, s.address, s.lat, s.lon, p.price, p.observed_at AS observedAt
       FROM stations s
       JOIN prices p ON p.id = (SELECT q.id FROM prices q WHERE q.station_id = s.id AND q.fuel = ?1
                                ORDER BY q.observed_at DESC, q.id DESC LIMIT 1)
       WHERE s.active = 1 AND s.lat BETWEEN ?3 AND ?4 AND s.lon BETWEEN ?5 AND ?6 AND p.observed_at >= ?2`,
    )
    .bind(fuel, sinceIso, box.minLat, box.maxLat, box.minLon, box.maxLon)
    .all<{ id: string; name: string; brand: string | null; address: string | null; lat: number; lon: number; price: number; observedAt: string }>();
  return results;
}

/** Newest successful prices run: its Oslo level L, when it finished, and nFresh (read with json_extract, no JSON.parse). */
export async function latestOkPricesRun(db: D1Database): Promise<{ level: number | null; at: string; nFresh: number | null } | null> {
  const r = await db
    .prepare(
      `SELECT json_extract(detail, '$.level') AS level, json_extract(detail, '$.nFresh') AS nFresh,
              COALESCE(finished_at, started_at) AS at
       FROM runs WHERE job = 'prices' AND ok = 1 ORDER BY started_at DESC, id DESC LIMIT 1`,
    )
    .first<{ level: unknown; nFresh: unknown; at: string }>();
  if (!r) return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { level: num(r.level), at: r.at, nFresh: num(r.nFresh) };
}

/** market_daily points of one series from `sinceDay` on (inclusive), ascending by day. */
export async function marketSeries(db: D1Database, series: string, sinceDay: string): Promise<Array<{ day: string; value: number }>> {
  const { results } = await db
    .prepare(`SELECT day, value FROM market_daily WHERE series = ?1 AND day >= ?2 ORDER BY day ASC`)
    .bind(series, sinceDay)
    .all<{ day: string; value: number }>();
  return results;
}
