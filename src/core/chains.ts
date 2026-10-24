// Daily price level per chain (docs/spec-flaws.md F23). Chains set prices centrally, so a chain's median
// over many stations is far more trustworthy than any single driver report. Measured in a fixed morning
// window (before the daily rise) so days compare like with like instead of drowning in the ±3 kr cycle.
import type { MarketPoint } from '../types';
import { median } from './stats';
import { osloDate, osloHour } from './time';

export const CHAINS = ['circlek', 'unox', 'esso', 'st1', 'other'] as const;
export type Chain = (typeof CHAINS)[number];
export type Group = Chain | 'all';
export const GROUPS: readonly Group[] = ['all', ...CHAINS];
export const CHAIN_FUELS = ['diesel', 'petrol95'] as const;
export type ChainFuel = (typeof CHAIN_FUELS)[number];

export const AM_FROM_H = 6; // Oslo time, inclusive
export const AM_TO_H = 12; // exclusive
export const MIN_STATIONS = 5; // fewer reporting stations → no level that day

/** Brand as stored from drivstoffapp.no ('Circle K Automat', 'Uno X TRUCK', 'Esso Express', …) → chain. */
export function chainOf(brand: string | null): Chain {
  const b = (brand ?? '').toLowerCase().replace(/[\s-]/g, '');
  if (b.startsWith('circlek')) return 'circlek';
  if (b.startsWith('unox')) return 'unox';
  if (b.startsWith('esso')) return 'esso';
  if (b.startsWith('st1')) return 'st1';
  return 'other';
}

export const amSeries = (g: Group, fuel: ChainFuel): string => `am_${g}_${fuel}`;

export interface BrandedReport {
  stationId: string;
  brand: string | null;
  fuel: string;
  price: number;
  observedAt: string;
}

/**
 * Morning levels for one Europe/Oslo day: per group and fuel, the median over stations of each station's
 * latest price reported AM_FROM_H–AM_TO_H that day. Groups with fewer than MIN_STATIONS stations are left out.
 */
export function amLevels(reports: BrandedReport[], day: string): MarketPoint[] {
  const latest = new Map<string, { group: Chain; fuel: ChainFuel; price: number; t: number }>();
  for (const r of reports) {
    if (!(CHAIN_FUELS as readonly string[]).includes(r.fuel)) continue;
    const d = new Date(r.observedAt);
    const t = d.getTime();
    if (!Number.isFinite(t) || osloDate(d) !== day) continue;
    const h = osloHour(d);
    if (h < AM_FROM_H || h >= AM_TO_H) continue;
    const key = `${r.stationId}|${r.fuel}`;
    const prev = latest.get(key);
    if (!prev || t > prev.t) latest.set(key, { group: chainOf(r.brand), fuel: r.fuel as ChainFuel, price: r.price, t });
  }
  const out: MarketPoint[] = [];
  for (const fuel of CHAIN_FUELS) {
    for (const g of GROUPS) {
      const xs = [...latest.values()].filter((v) => v.fuel === fuel && (g === 'all' || v.group === g)).map((v) => v.price);
      if (xs.length >= MIN_STATIONS) out.push({ day, series: amSeries(g, fuel), value: Math.round(median(xs)! * 100) / 100 });
    }
  }
  return out;
}
