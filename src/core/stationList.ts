// GET /api/stations list building (docs/web-v1-contract.md): pure, so the route handler stays thin.
import type { Fuel } from '../types';
import { haversineKm } from './geo';
import { netSavingNok } from './netSaving';
import { median } from './stats';
import { isOutdated, isUnconfirmed, recentMedian, type PlacedPrice } from './priceJump';

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
  distanceKm: number;
  netSavingNok: number | null;
}

/** How many stations in the radius have a current price (pre-jump prices are hidden, not shown). */
export interface Coverage {
  current: number;
  hiddenOutdated: number;
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
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Keep prices ≤ 24 h old within `radiusKm` of `origin`, pick the reference price, compute net saving,
 * and sort: fresh (≤ 6 h) rows before stale ones (IMPL-W12, deviates from the contract's pure net-saving sort),
 * then net saving desc (nulls last), then price asc, then distance asc.
 *
 * refPrice: the Oslo level L for diesel when known, else the median of fresh (≤ 6 h) prices in the radius,
 * else null (then every netSavingNok is null).
 */
export function buildStations(rows: StationPriceRow[], o: BuildOpts): StationsResponse {
  const nowMs = o.now.getTime();
  const maxAgeMs = MAX_AGE_HOURS * 3_600_000;
  const staleMs = STALE_HOURS * 3_600_000;

  // Area-wide view from all rows (not just the radius): spot prices that predate a market-wide jump
  // and recent prices that are implausibly cheap (src/core/priceJump.ts).
  const placed: PlacedPrice[] = rows
    .map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, price: r.price, t: Date.parse(r.observedAt) }))
    .filter((p) => Number.isFinite(p.t) && nowMs - p.t <= maxAgeMs);
  const recentMed = recentMedian(placed, nowMs);
  const outdatedAreaWide = placed.filter((p) => isOutdated(p, nowMs, recentMed)).length;
  let hiddenOutdated = 0;

  const kept: Array<Omit<StationItem, 'netSavingNok'> & { exactKm: number; ageMs: number }> = [];
  for (const r of rows) {
    const t = Date.parse(r.observedAt);
    if (!Number.isFinite(t)) continue;
    const ageMs = Math.max(0, nowMs - t); // a price "from the future" (clock skew) counts as brand new
    if (nowMs - t > maxAgeMs) continue;
    const exactKm = haversineKm(o.origin, r);
    if (exactKm > o.radiusKm) continue;
    // Prices from before today's market-wide jump are hidden: an old number is worse than none.
    if (isOutdated({ price: r.price, t }, nowMs, recentMed)) {
      hiddenOutdated++;
      continue;
    }
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
      distanceKm: round2(exactKm),
      exactKm,
      ageMs,
    });
  }

  const level = o.fuel === 'diesel' && typeof o.osloLevel === 'number' && Number.isFinite(o.osloLevel) ? o.osloLevel : null;
  const refPrice = level ?? median(kept.filter((k) => !k.stale && !k.unconfirmed).map((k) => k.price));

  const stations: StationItem[] = kept.map(({ exactKm: _e, ageMs: _a, ...k }) => ({
    ...k,
    netSavingNok: refPrice === null ? null : netSavingNok(refPrice, k.price, k.distanceKm, o.tankL, o.consumptionL100),
  }));
  stations.sort(
    (a, b) =>
      // Confirmed fresh first, then unconfirmed, then stale.
      Number(a.stale) * 2 + Number(a.unconfirmed) - (Number(b.stale) * 2 + Number(b.unconfirmed)) ||
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
    coverage: { current: stations.length, hiddenOutdated, jumpDetected: outdatedAreaWide >= 5 },
    stations,
  };
}
