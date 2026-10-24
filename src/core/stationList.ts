// GET /api/stations list building (docs/web-v1-contract.md): pure, so the route handler stays thin.
import type { Fuel } from '../types';
import { haversineKm } from './geo';
import { netSavingNok } from './netSaving';
import { median } from './stats';
import { isOutdated, recentMedian } from './priceJump';

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
  distanceKm: number;
  netSavingNok: number | null;
}

export interface StationsResponse {
  fuel: Fuel;
  origin: { lat: number; lon: number };
  radiusKm: number;
  refPrice: number | null;
  generatedAt: string;
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

  // Area-wide recent median from all rows (not just the radius), to spot prices that predate a jump.
  const recentMed = recentMedian(
    rows.map((r) => ({ price: r.price, t: Date.parse(r.observedAt) })).filter((p) => Number.isFinite(p.t)),
    nowMs,
  );

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
      // Outdated (before a market-wide jump) is treated like stale: greyed, ranked last, not in the reference.
      stale: ageMs > staleMs || isOutdated({ price: r.price, t }, nowMs, recentMed),
      distanceKm: round2(exactKm),
      exactKm,
      ageMs,
    });
  }

  const level = o.fuel === 'diesel' && typeof o.osloLevel === 'number' && Number.isFinite(o.osloLevel) ? o.osloLevel : null;
  const refPrice = level ?? median(kept.filter((k) => !k.stale).map((k) => k.price));

  const stations: StationItem[] = kept.map(({ exactKm: _e, ageMs: _a, ...k }) => ({
    ...k,
    netSavingNok: refPrice === null ? null : netSavingNok(refPrice, k.price, k.distanceKm, o.tankL, o.consumptionL100),
  }));
  stations.sort(
    (a, b) =>
      Number(a.stale) - Number(b.stale) ||
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
    stations,
  };
}
