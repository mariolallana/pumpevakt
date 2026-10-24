// Oslo level L (docs/04 "Shared definitions").
import type { Fuel, StationObs } from '../types';
import { haversineKm, OSLO_S } from './geo';
import { median } from './stats';
import { detectRise, isOutdated } from './rise';

export interface OsloLevel {
  median: number;
  nFresh: number;
}

export const AREA_RADIUS_KM = 25;
export const FRESH_HOURS = 6;
export const MIN_FRESH = 30;

/**
 * Median of fresh prices for `fuel` at stations within `radiusKm` of Oslo S.
 * Fresh = observed at most `freshHours` before `now` (age <= freshHours, inclusive; the literal docs/04 reading).
 * One price per station (the newest, if a station appears twice). Returns null if nFresh < minFresh.
 * Prices that predate a market-wide rise are left out of the median (src/core/rise.ts).
 */
export function osloLevel(
  obs: StationObs[],
  now: Date,
  opts: { fuel?: Fuel; radiusKm?: number; freshHours?: number; minFresh?: number } = {},
): OsloLevel | null {
  const fuel = opts.fuel ?? 'diesel';
  const radiusKm = opts.radiusKm ?? AREA_RADIUS_KM;
  const freshMs = (opts.freshHours ?? FRESH_HOURS) * 3_600_000;
  const minFresh = opts.minFresh ?? MIN_FRESH;
  const nowMs = now.getTime();

  const perStation = new Map<string, { price: number; t: number }>();
  for (const o of obs) {
    if (o.fuel !== fuel) continue;
    const t = Date.parse(o.observedAt);
    if (!Number.isFinite(t)) continue;
    if (nowMs - t > freshMs) continue;
    if (haversineKm(OSLO_S, o.station) > radiusKm) continue;
    const prev = perStation.get(o.station.id);
    if (!prev || t > prev.t) perStation.set(o.station.id, { price: o.price, t });
  }

  const fresh = [...perStation.values()];
  const nFresh = fresh.length;
  if (nFresh < minFresh || nFresh === 0) return null;
  // Drop prices that predate today's market-wide rise (src/core/rise.ts); keep the coverage count as-is.
  const rise = detectRise(fresh, nowMs);
  const current = fresh.filter((v) => !isOutdated(v, rise)).map((v) => v.price);
  return { median: median(current.length ? current : fresh.map((v) => v.price))!, nFresh };
}
