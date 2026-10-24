// Jump-aware freshness (docs/spec-flaws.md F19). Norwegian pump prices jump market-wide once a day
// (seen 2026-10-24: Oslo diesel median 24.43 → 27.45 within ~2 h). A price observed before the jump
// still looks "fresh" (≤ 6 h) but is out of date. Rule: a price older than RECENT_HOURS that is at least
// JUMP_NOK below the median of prices observed within RECENT_HOURS (needs MIN_RECENT of them) is outdated.
// Recent cheap prices are kept: they may be genuine bargains (the outlier alarm's whole point).
import { median } from './stats';

export const RECENT_HOURS = 2;
export const MIN_RECENT = 10;
export const JUMP_NOK = 1.0;

export interface TimedPrice {
  price: number;
  t: number; // epoch ms of observation
}

/** Median of prices observed within RECENT_HOURS of `nowMs`, or null if fewer than MIN_RECENT. */
export function recentMedian(prices: TimedPrice[], nowMs: number): number | null {
  const recent = prices.filter((p) => nowMs - p.t <= RECENT_HOURS * 3_600_000).map((p) => p.price);
  return recent.length >= MIN_RECENT ? median(recent) : null;
}

/** True if `p` predates a market-wide jump that the recent median reveals. */
export function isOutdated(p: TimedPrice, nowMs: number, recentMed: number | null): boolean {
  if (recentMed === null) return false;
  return nowMs - p.t > RECENT_HOURS * 3_600_000 && recentMed - p.price >= JUMP_NOK;
}
