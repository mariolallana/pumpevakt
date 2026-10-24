// Daily price spread for the 30-day chart: p25/p50/p75 of every price reported that Europe/Oslo day.
// A whole day mixes pre- and post-rise prices, so the band shows the day's range and p50 its centre.
import type { MarketPoint } from '../types';
import { CHAIN_FUELS, type BrandedReport } from './chains';
import { osloDate } from './time';

export const MIN_DAY_REPORTS = 20; // fewer reports that day → no point (too thin for quartiles)
export const QUANTILES = [25, 50, 75] as const;
export type Quantile = (typeof QUANTILES)[number];

export const spreadSeries = (q: Quantile, fuel: string): string => `p${q}_${fuel}`;

/** q-th percentile (0–100) of an ascending-sorted, non-empty list, linear interpolation between ranks. */
export function percentile(sorted: number[], q: number): number {
  const pos = ((sorted.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** p25/p50/p75 per fuel for one Oslo day, from every report observed that day. */
export function daySpread(reports: BrandedReport[], day: string): MarketPoint[] {
  const out: MarketPoint[] = [];
  for (const fuel of CHAIN_FUELS) {
    const xs = reports
      .filter((r) => r.fuel === fuel && osloDate(new Date(r.observedAt)) === day)
      .map((r) => r.price)
      .sort((a, b) => a - b);
    if (xs.length < MIN_DAY_REPORTS) continue;
    for (const q of QUANTILES) out.push({ day, series: spreadSeries(q, fuel), value: Math.round(percentile(xs, q) * 100) / 100 });
  }
  return out;
}
