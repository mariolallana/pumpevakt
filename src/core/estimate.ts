// Rough pump-price estimate for the 30-day chart's days before Pumpevakt started recording (owner decision
// 2026-10-25, docs/spec-flaws-impl.md IMPL-W15). Display only: never stored as prices, never used by the
// verdict, the normal level or alarms. Estimate = wholesale (WDI, latest published on or before the day) +
// the median gap between our recorded daily level and WDI. The pump−WDI gap moved 10.6–15.8 kr between
// months in 2026 (SSB backtest), so the estimate can be off by several kroner and misses the daily cycle.
import { median } from './stats';

/** How far off the estimate can be, NOK/L (shown to the user). */
export const ESTIMATE_ERROR_NOK = '3–5';

export interface PumpEstimate {
  /** Median of (recorded daily level − WDI) over the calibration days. */
  gap: number;
  /** Recorded days used for the gap. */
  nCal: number;
  /** One point per day before the first recorded day that has a WDI value on or before it. */
  points: Array<{ day: string; value: number }>;
}

type Day = { day: string; value: number };
type SpreadRow = { day: string; am?: { p50: number }; pm?: { p50: number } };

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Latest WDI published on or before `day` (weekends and holidays carry the last trading day). */
function wdiOn(wdi: Day[], day: string): number | null {
  for (let i = wdi.length - 1; i >= 0; i--) if (wdi[i]!.day <= day) return wdi[i]!.value;
  return null;
}

/**
 * `spread` and `wdi` ascending by day, `days` the chart's slots (ascending). Null without any recorded day
 * that has a WDI to calibrate against. A recorded day's level is the mean of its morning and afternoon medians.
 */
export function estimatePump(spread: SpreadRow[], wdi: Day[], days: string[]): PumpEstimate | null {
  const gaps: number[] = [];
  for (const row of spread) {
    const mids = [row.am?.p50, row.pm?.p50].filter((v): v is number => v !== undefined);
    const w = wdiOn(wdi, row.day);
    if (mids.length === 0 || w === null) continue;
    gaps.push(mids.reduce((a, b) => a + b, 0) / mids.length - w);
  }
  const first = spread[0]?.day;
  if (gaps.length === 0 || !first) return null;
  const gap = round2(median(gaps)!);
  const points: Day[] = [];
  for (const day of days) {
    if (day >= first) break;
    const w = wdiOn(wdi, day);
    if (w !== null) points.push({ day, value: round2(w + gap) });
  }
  return { gap, nCal: gaps.length, points };
}
