// GET /api/stations list building (docs/web-v1-contract.md): pure, so the route handler stays thin.
import type { Fuel } from '../types';
import { haversineKm } from './geo';
import { netSavingNok } from './netSaving';
import { median } from './stats';
import { isUnconfirmed, recentMedian, type PlacedPrice } from './priceJump';
import { detectRise, isOutdated, type Rise } from './rise';

export const MAX_AGE_HOURS = 24; // older prices are never returned
export const STALE_HOURS = 6; // older prices are returned but flagged `stale` (and greyed in the UI)

/** One station with its latest price for the requested fuel, as read from D1. */
export interface StationPriceRow {
  id: string;
  name: string;
  brand: string | null;
  address: string | null;
  lat: number;
  lon: number;
  price: number;
  observedAt: string;
}

export interface StationItem {
  id: string;
  name: string;
  brand: string;
  address: string;
  lat: number;
  lon: number;
  price: number;
  observedAt: string;
  ageMinutes: number;
  stale: boolean;
  /** Recent but implausibly cheap (> 3 kr below the recent market) with no nearby report agreeing. */
  unconfirmed: boolean;
  /** Reported before today's market-wide rise: probably higher now. Listed last, no saving claimed. */
  outdated: boolean;
  distanceKm: number;
  netSavingNok: number | null;
}

/** How many stations in the radius have a current price vs one from before the latest market-wide rise. */
export interface Coverage {
  current: number;
  outdated: number;
  jumpDetected: boolean;
}

export interface StationsResponse {
  fuel: Fuel;
  origin: { lat: number; lon: number };
  radiusKm: number;
  refPrice: number | null;
  generatedAt: string;
  coverage: Coverage;
  stations: StationItem[];
}

export interface BuildOpts {
  fuel: Fuel;
  origin: { lat: number; lon: number };
  radiusKm: number;
  now: Date;
  /** Latest Oslo level L (diesel only); null/undefined → fall back to the median of fresh prices in the radius. */
  osloLevel?: number | null;
  tankL: number;
  consumptionL100: number;
  /** Oslo-wide rise from the latest prices run; undefined → detected from `rows` (null = known: no rise). */
  rise?: Rise | null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
/** Sort group: confirmed fresh 0, unconfirmed 1, stale 2, outdated 3. */
const group = (s: StationItem): number => (s.outdated ? 3 : s.stale ? 2 : s.unconfirmed ? 1 : 0);

/**
 * Keep prices ≤ 24 h old within `radiusKm` of `origin`, pick the reference price, compute net saving,
 * and sort in groups — confirmed fresh, unconfirmed, stale (> 6 h, IMPL-W12), outdated (F22) — then
 * net saving desc (nulls last), then price asc, then distance asc. Outdated rows get no net saving.
 *
 * refPrice: the Oslo level L for diesel when known, else the median of fresh (≤ 6 h) prices in the radius,
 * else null (then every netSavingNok is null).
 */
export function buildStations(rows: StationPriceRow[], o: BuildOpts): StationsResponse {
  const nowMs = o.now.getTime();
  const maxAgeMs = MAX_AGE_HOURS * 3_600_000;
  const staleMs = STALE_HOURS * 3_600_000;

  // Prices that predate the latest market-wide rise (src/core/rise.ts) and recent prices that are
  // implausibly cheap (src/core/priceJump.ts).
  const placed: PlacedPrice[] = rows
    .map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, price: r.price, t: Date.parse(r.observedAt) }))
    .filter((p) => Number.isFinite(p.t) && nowMs - p.t <= maxAgeMs);
  const recentMed = recentMedian(placed, nowMs);
  const rise = o.rise !== undefined ? o.rise : detectRise(placed, nowMs);

  const kept: Array<Omit<StationItem, 'netSavingNok'> & { exactKm: number; ageMs: number }> = [];
  for (const r of rows) {
    const t = Date.parse(r.observedAt);
    if (!Number.isFinite(t)) continue;
    const ageMs = Math.max(0, nowMs - t); // a price "from the future" (clock skew) counts as brand new
    if (nowMs - t > maxAgeMs) continue;
    const exactKm = haversineKm(o.origin, r);
    if (exactKm > o.radiusKm) continue;
    kept.push({
      id: r.id,
      name: r.name,
      brand: r.brand ?? '',
      address: r.address ?? '',
      lat: r.lat,
      lon: r.lon,
      price: r.price,
      observedAt: r.observedAt,
      ageMinutes: Math.floor(ageMs / 60_000),
      stale: ageMs > staleMs,
      unconfirmed: isUnconfirmed({ id: r.id, lat: r.lat, lon: r.lon, price: r.price, t }, placed, nowMs, recentMed),
      outdated: isOutdated({ price: r.price, t }, rise),
      distanceKm: round2(exactKm),
      exactKm,
      ageMs,
    });
  }

  const level = o.fuel === 'diesel' && typeof o.osloLevel === 'number' && Number.isFinite(o.osloLevel) ? o.osloLevel : null;
  const refPrice = level ?? median(kept.filter((k) => !k.stale && !k.unconfirmed && !k.outdated).map((k) => k.price));

  const stations: StationItem[] = kept.map(({ exactKm: _e, ageMs: _a, ...k }) => ({
    ...k,
    netSavingNok: refPrice === null || k.outdated ? null : netSavingNok(refPrice, k.price, k.distanceKm, o.tankL, o.consumptionL100),
  }));
  stations.sort(
    (a, b) =>
      group(a) - group(b) ||
      (b.netSavingNok ?? -Infinity) - (a.netSavingNok ?? -Infinity) ||
      a.price - b.price ||
      a.distanceKm - b.distanceKm ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return {
    fuel: o.fuel,
    origin: o.origin,
    radiusKm: o.radiusKm,
    refPrice,
    generatedAt: o.now.toISOString(),
    coverage: {
      current: stations.filter((s) => !s.outdated).length,
      outdated: stations.filter((s) => s.outdated).length,
      jumpDetected: rise !== null,
    },
    stations,
  };
}
