// Jump-aware freshness (docs/spec-flaws.md F19). Norwegian pump prices jump market-wide once a day
// (seen 2026-10-24: Oslo diesel median 24.43 → 27.45 within ~2 h). A price observed before the jump
// still looks "fresh" (≤ 6 h) but is out of date. Rule: a price older than RECENT_HOURS that is at least
// JUMP_NOK below the recent median is outdated. Recent cheap prices are kept: they may be genuine bargains
// (the outlier alarm's whole point). Outdated prices are flagged, never hidden (F22: users looked for
// stations they could see on the street).
import { haversineKm } from './geo';
import { median } from './stats';

export const RECENT_HOURS = 2;
export const MIN_RECENT = 10;
export const JUMP_NOK = 1.0;

export interface TimedPrice {
  price: number;
  t: number; // epoch ms of observation
}

/**
 * Median of the prices observed within RECENT_HOURS of `nowMs`, topped up to the MIN_RECENT newest ones when
 * fewer were reported (evenings are quiet: a fixed 2 h window would switch the rule off, F22).
 * Null if there are fewer than MIN_RECENT prices in total.
 */
export function recentMedian(prices: TimedPrice[], nowMs: number): number | null {
  if (prices.length < MIN_RECENT) return null;
  const newestFirst = [...prices].sort((a, b) => b.t - a.t);
  const inWindow = newestFirst.filter((p) => nowMs - p.t <= RECENT_HOURS * 3_600_000).length;
  return median(newestFirst.slice(0, Math.max(MIN_RECENT, inWindow)).map((p) => p.price));
}

/** True if `p` predates a market-wide jump that the recent median reveals. */
export function isOutdated(p: TimedPrice, nowMs: number, recentMed: number | null): boolean {
  if (recentMed === null) return false;
  return nowMs - p.t > RECENT_HOURS * 3_600_000 && recentMed - p.price >= JUMP_NOK;
}

// Implausible recent prices (user-testing 2026-10-24: Circle K Bjerke reported 23.23 while Circle K
// Abildsø was 28.68 and Kiellands Plass 29.18). Real Oslo bargains are rarely > ~2 kr below the market.
export const UNCONFIRMED_NOK = 3.0; // a recent price this far below the recent median is suspicious…
export const AGREE_KM = 3; // …unless another recent price within this distance…
export const AGREE_NOK = 0.5; // …is within this many kr of it (neighbour agreement confirms it).

export interface PlacedPrice extends TimedPrice {
  id: string;
  lat: number;
  lon: number;
}

/** True if `p` is recent but implausibly cheap and no recent neighbour backs it up. */
export function isUnconfirmed(p: PlacedPrice, all: PlacedPrice[], nowMs: number, recentMed: number | null): boolean {
  const recentMs = RECENT_HOURS * 3_600_000;
  if (recentMed === null || nowMs - p.t > recentMs || recentMed - p.price < UNCONFIRMED_NOK) return false;
  return !all.some(
    (q) =>
      q.id !== p.id &&
      nowMs - q.t <= recentMs &&
      Math.abs(q.price - p.price) <= AGREE_NOK &&
      haversineKm(p, q) <= AGREE_KM,
  );
}
