// "Fill up now or wait?" (docs/spec-flaws.md F23): the headline answer, from market-wide signals only.
// Timing (~3 kr daily cycle) is worth more than location, and market-wide medians survive the odd wrong
// driver report. Facts (the rise, the morning level) are kept apart from the advice they lead to.
import { RISE_NOK, type Rise } from './rise';
import { median } from './stats';

export type Verdict = 'wait' | 'good' | 'normal' | 'unknown';

export const NORM_DAYS = 14; // "normal" = median morning level of up to this many previous days…
export const MIN_NORM_DAYS = 5; // …and only once there are at least this many

export interface Norm {
  /** Latest morning level (today's when available). */
  day: string | null;
  level: number | null;
  /** Median of the previous days' morning levels, null while learning. */
  normal: number | null;
  /** Previous days available (≤ NORM_DAYS). */
  nDays: number;
  delta: number | null;
}

/**
 * wait    — prices rose in the last 24 h and are still ≥ RISE_NOK above the pre-rise level
 * good    — a rise happened but prices have eased back to near the pre-rise level
 * normal  — no rise detected in the last 24 h
 * unknown — not enough current prices
 */
export function verdict(hasData: boolean, rise: Rise | null): Verdict {
  if (!hasData) return 'unknown';
  if (!rise) return 'normal';
  return (rise.now ?? rise.after) - rise.before >= RISE_NOK ? 'wait' : 'good';
}

/** `am` ascending by day (one Oslo-wide morning level per day). */
export function norm(am: Array<{ day: string; value: number }>): Norm {
  const last = am.at(-1);
  if (!last) return { day: null, level: null, normal: null, nDays: 0, delta: null };
  const prev = am.slice(0, -1).slice(-NORM_DAYS).map((p) => p.value);
  const normal = prev.length >= MIN_NORM_DAYS ? median(prev) : null;
  return {
    day: last.day,
    level: last.value,
    normal,
    nDays: prev.length,
    delta: normal === null ? null : Math.round((last.value - normal) * 100) / 100,
  };
}
