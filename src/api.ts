// Read-only JSON API for the web page (docs/web-v1-contract.md, docs/05 §2). Thin: validate → a few
// indexed D1 queries → pure core functions. No business logic here.
import { loadConfig } from './config';
import { OSLO_S } from './core/geo';
import { buildStations, MAX_AGE_HOURS, type StationsResponse } from './core/stationList';
import { osloDate } from './core/time';
import { WDI_SERIES } from './core/wdi';
import { amLevels, amSeries, CHAIN_FUELS, GROUPS, type ChainFuel, type Group } from './core/chains';
import { daySpread, QUANTILES, spreadSeries, WINDOWS, type SpreadWindow } from './core/dailySpread';
import { norm, verdict, type Norm, type Verdict } from './core/outlook';
import type { Rise } from './core/rise';
import { brandedReportsSince, latestOkPricesRun, latestStationPrices, marketSeries, marketSeriesMany } from './db';
import { OSLO_MEDIAN_SERIES } from './jobs/prices';
import type { Env, Fuel } from './types';
import { FUELS } from './types';

export const CACHE_CONTROL = 'public, max-age=60';
export const DEFAULT_RADIUS_KM = 10;
export const MAX_RADIUS_KM = 30;
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;

export interface MarketResponse {
  days: number;
  osloDieselMedian: Array<{ day: string; value: number }>;
  wdi: Array<{ day: string; value: number }>;
  latest: { level: number | null; at: string | null; nFresh: number | null };
}

export interface OutlookResponse {
  fuel: ChainFuel;
  generatedAt: string;
  verdict: Verdict;
  /** Latest Oslo-wide daily rise (≤ 24 h), see src/core/rise.ts. */
  rise: Rise | null;
  /** Oslo level now (median of current prices) and when it was measured. */
  level: number | null;
  levelAt: string | null;
  /** Today's (or the latest) Oslo-wide morning level vs the previous days' normal. */
  norm: Norm;
  /** Morning (06–12) level per chain, one row per day with data, oldest first; today's row is live. */
  history: Array<{ day: string; levels: Partial<Record<Group, number>> }>;
  /**
   * Per day (oldest first; today live): p25/p50/p75 across stations in the morning (06–12, before the daily
   * rise) and afternoon/evening (15–24, after it). A window is present only with ≥ 10 stations reporting.
   */
  spread: Array<{ day: string } & Partial<Record<SpreadWindow, SpreadQ>>>;
  /** Official wholesale diesel cost, NOK/L (FRED ULSD × Norges Bank); empty for petrol. */
  wdi: Array<{ day: string; value: number }>;
}

export interface SpreadQ {
  p25: number;
  p50: number;
  p75: number;
}

export const OUTLOOK_DAYS = 30;
const WINDOW_KEYS = Object.keys(WINDOWS) as SpreadWindow[];
const SPREAD_KEYS = WINDOW_KEYS.flatMap((w) => QUANTILES.map((q) => ({ w, q })));

export class BadInput extends Error {}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

export const apiOk = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { ...jsonHeaders, 'cache-control': CACHE_CONTROL } });

export const apiError = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { ...jsonHeaders, 'cache-control': 'no-store' } });

/** A numeric query param: absent → undefined; present but empty/non-numeric → BadInput. */
function numParam(q: URLSearchParams, key: string): number | undefined {
  const raw = q.get(key);
  if (raw === null) return undefined;
  const s = raw.trim();
  const n = s === '' ? NaN : Number(s);
  if (!Number.isFinite(n)) throw new BadInput(`${key} must be a number`);
  return n;
}

export interface StationsParams {
  origin: { lat: number; lon: number };
  radiusKm: number;
  fuel: Fuel;
}

/**
 * Validate /api/stations params. lat/lon are optional together; when both are missing the origin is Oslo S
 * (never HOME: this endpoint is public and must not reveal personal data, docs/05 §2; IMPL-W11).
 */
export function parseStationsParams(q: URLSearchParams, fallback: { lat: number; lon: number } = OSLO_S): StationsParams {
  const lat = numParam(q, 'lat');
  const lon = numParam(q, 'lon');
  if ((lat === undefined) !== (lon === undefined)) throw new BadInput('lat and lon must be given together');
  if (lat !== undefined && (lat < -90 || lat > 90)) throw new BadInput('lat must be between -90 and 90');
  if (lon !== undefined && (lon < -180 || lon > 180)) throw new BadInput('lon must be between -180 and 180');
  const radiusKm = numParam(q, 'radius_km') ?? DEFAULT_RADIUS_KM;
  if (radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) throw new BadInput(`radius_km must be > 0 and ≤ ${MAX_RADIUS_KM}`);
  const fuelRaw = q.get('fuel');
  const fuel = fuelRaw === null ? 'diesel' : (fuelRaw.trim() as Fuel);
  if (!FUELS.includes(fuel)) throw new BadInput(`fuel must be one of ${FUELS.join(', ')}`);
  return { origin: lat !== undefined && lon !== undefined ? { lat, lon } : { ...fallback }, radiusKm, fuel };
}

export function parseMarketParams(q: URLSearchParams): { days: number } {
  const days = numParam(q, 'days') ?? DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new BadInput(`days must be an integer from 1 to ${MAX_DAYS}`);
  return { days };
}

const KM_PER_DEG = 111.195;

export async function stationsHandler(url: URL, env: Env, now = new Date()): Promise<StationsResponse> {
  const cfg = loadConfig(env);
  const p = parseStationsParams(url.searchParams);
  // Cheap pre-filter in SQL (a box slightly larger than the circle); the exact haversine cut is in core.
  const dLat = (p.radiusKm / KM_PER_DEG) * 1.01;
  const dLon = dLat / Math.max(0.01, Math.cos((p.origin.lat * Math.PI) / 180));
  const since = new Date(now.getTime() - MAX_AGE_HOURS * 3_600_000).toISOString();
  const [rows, run] = await Promise.all([
    latestStationPrices(env.DB, p.fuel, since, {
      minLat: p.origin.lat - dLat,
      maxLat: p.origin.lat + dLat,
      minLon: p.origin.lon - dLon,
      maxLon: p.origin.lon + dLon,
    }),
    latestOkPricesRun(env.DB),
  ]);
  // Oslo-wide rise from the last run for the headline fuels; otherwise buildStations detects it from `rows`.
  const rise = run?.rises && p.fuel in run.rises ? run.rises[p.fuel] : undefined;
  return buildStations(rows, {
    fuel: p.fuel,
    origin: p.origin,
    radiusKm: p.radiusKm,
    now,
    osloLevel: p.fuel === 'diesel' ? (run?.level ?? null) : null,
    tankL: cfg.tankL,
    consumptionL100: cfg.consumptionL100,
    rise,
  });
}

export async function outlookHandler(url: URL, env: Env, now = new Date()): Promise<OutlookResponse> {
  const fuel = (url.searchParams.get('fuel') ?? 'diesel') as ChainFuel;
  if (!CHAIN_FUELS.includes(fuel)) throw new BadInput(`fuel must be one of ${CHAIN_FUELS.join(', ')}`);
  const today = osloDate(now);
  const since = osloDate(new Date(now.getTime() - (OUTLOOK_DAYS - 1) * 86_400_000));
  const [run, points, reports, wdi] = await Promise.all([
    latestOkPricesRun(env.DB),
    marketSeriesMany(env.DB, [...GROUPS.map((g) => amSeries(g, fuel)), ...SPREAD_KEYS.map(({ w, q }) => spreadSeries(w, q, fuel))], since),
    // Today's morning levels are computed live; earlier days come from the market job.
    brandedReportsSince(env.DB, new Date(now.getTime() - 26 * 3_600_000).toISOString()),
    fuel === 'diesel' ? marketSeries(env.DB, WDI_SERIES, since) : Promise.resolve([]),
  ]);
  const live = [...amLevels(reports, today), ...daySpread(reports, today)];
  const stored = points.filter((x) => x.day !== today);
  const spreadByDay = new Map<string, Record<string, number>>(); // day → { 'am25': …, 'pm75': … }
  for (const pt of [...stored, ...live]) {
    const k = SPREAD_KEYS.find(({ w, q }) => spreadSeries(w, q, fuel) === pt.series);
    if (k) spreadByDay.set(pt.day, { ...spreadByDay.get(pt.day), [`${k.w}${k.q}`]: pt.value });
  }
  const spread = [...spreadByDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, v]) => {
      const row: OutlookResponse['spread'][number] = { day };
      for (const w of WINDOW_KEYS) {
        if (v[`${w}25`] !== undefined && v[`${w}50`] !== undefined && v[`${w}75`] !== undefined) row[w] = { p25: v[`${w}25`]!, p50: v[`${w}50`]!, p75: v[`${w}75`]! };
      }
      return row;
    })
    .filter((row) => WINDOW_KEYS.some((w) => row[w]));
  const byDay = new Map<string, Partial<Record<Group, number>>>();
  for (const pt of [...stored, ...live]) {
    const g = GROUPS.find((x) => amSeries(x, fuel) === pt.series);
    if (!g) continue;
    byDay.set(pt.day, { ...byDay.get(pt.day), [g]: pt.value });
  }
  const history = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, levels]) => ({ day, levels }));
  const rawLevel = fuel === 'diesel' ? (run?.levels?.diesel ?? run?.level ?? null) : (run?.levels?.[fuel] ?? null);
  const level = rawLevel === null ? null : Math.round(rawLevel * 100) / 100;
  const rise = run?.rises?.[fuel] ?? null;
  return {
    fuel,
    generatedAt: now.toISOString(),
    verdict: verdict(level !== null, rise),
    rise,
    level,
    levelAt: run?.at ?? null,
    norm: norm(history.filter((h) => h.levels.all !== undefined).map((h) => ({ day: h.day, value: h.levels.all! }))),
    history,
    spread,
    wdi,
  };
}

export async function marketHandler(url: URL, env: Env, now = new Date()): Promise<MarketResponse> {
  const { days } = parseMarketParams(url.searchParams);
  // The last `days` Europe/Oslo calendar days, today included.
  const since = osloDate(new Date(now.getTime() - (days - 1) * 86_400_000));
  const [osloDieselMedian, wdi, run] = await Promise.all([
    marketSeries(env.DB, OSLO_MEDIAN_SERIES, since),
    marketSeries(env.DB, WDI_SERIES, since),
    latestOkPricesRun(env.DB),
  ]);
  return { days, osloDieselMedian, wdi, latest: { level: run?.level ?? null, at: run?.at ?? null, nFresh: run?.nFresh ?? null } };
}

/** Route /api/* (GET only). Returns null for paths it doesn't own. */
export async function handleApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return apiError(405, 'METHOD_NOT_ALLOWED', 'only GET is supported');
  try {
    if (url.pathname === '/api/stations') return apiOk(await stationsHandler(url, env));
    if (url.pathname === '/api/market') return apiOk(await marketHandler(url, env));
    if (url.pathname === '/api/outlook') return apiOk(await outlookHandler(url, env));
    return apiError(404, 'NOT_FOUND', `no route ${url.pathname}`);
  } catch (e) {
    if (e instanceof BadInput) return apiError(400, 'BAD_INPUT', e.message);
    console.error(`api ${url.pathname} failed: ${e instanceof Error ? e.message : String(e)}`);
    return apiError(500, 'INTERNAL', 'internal error');
  }
}
