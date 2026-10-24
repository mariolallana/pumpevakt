// Daily price spread for the 30-day chart, split into the two halves of the Norwegian price cycle: the
// morning before the daily rise and the afternoon/evening after it. Mixing a whole day would blend the
// two levels (2026-10-24: one "daily median" of 25.07 while pumps were at 27.3 after the rise).
// Per window: each station's latest report in it, then p25/p50/p75 across stations — the spread between
// cheap and dear stations at the same time of day.
import type { MarketPoint } from '../types';
import { CHAIN_FUELS, type BrandedReport } from './chains';
import { osloDate, osloHour } from './time';

/** Oslo-time windows [from, to) in hours. */
export const WINDOWS = { am: [6, 12], pm: [15, 24] } as const;
export type SpreadWindow = keyof typeof WINDOWS;
export const MIN_SPREAD_STATIONS = 10; // fewer stations reporting in a window → no point for it
export const QUANTILES = [25, 50, 75] as const;
export type Quantile = (typeof QUANTILES)[number];

export const spreadSeries = (w: SpreadWindow, q: Quantile, fuel: string): string => `spread_${w}_p${q}_${fuel}`;

/** q-th percentile (0–100) of an ascending-sorted, non-empty list, linear interpolation between ranks. */
export function percentile(sorted: number[], q: number): number {
  const pos = ((sorted.length - 1) * q) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** p25/p50/p75 per fuel and window for one Oslo day. */
export function daySpread(reports: BrandedReport[], day: string): MarketPoint[] {
  const latest = new Map<string, { price: number; t: number }>(); // key: fuel|window|station
  for (const r of reports) {
    const d = new Date(r.observedAt);
    const t = d.getTime();
    if (!Number.isFinite(t) || osloDate(d) !== day) continue;
    const h = osloHour(d);
    const w = (Object.keys(WINDOWS) as SpreadWindow[]).find((k) => h >= WINDOWS[k][0] && h < WINDOWS[k][1]);
    if (!w) continue;
    const key = `${r.fuel}|${w}|${r.stationId}`;
    const prev = latest.get(key);
    if (!prev || t > prev.t) latest.set(key, { price: r.price, t });
  }
  const out: MarketPoint[] = [];
  for (const fuel of CHAIN_FUELS) {
    for (const w of Object.keys(WINDOWS) as SpreadWindow[]) {
      const xs = [...latest.entries()]
        .filter(([k]) => k.startsWith(`${fuel}|${w}|`))
        .map(([, v]) => v.price)
        .sort((a, b) => a - b);
      if (xs.length < MIN_SPREAD_STATIONS) continue;
      for (const q of QUANTILES) out.push({ day, series: spreadSeries(w, q, fuel), value: Math.round(percentile(xs, q) * 100) / 100 });
    }
  }
  return out;
}
