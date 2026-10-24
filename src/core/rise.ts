// Market-wide daily price rise (docs/spec-flaws.md F23). Norwegian chains raise pump prices about once a
// day, then prices drift down until the next rise. Input is each station's latest reported price (the
// snapshot every prices run sees). Detected market-wide only: per-chain hourly reports are too thin
// (1–13 an hour on 2026-10-24) while the whole market had 30–70 reports either side of the rise.
import type { TimedPrice } from './priceJump';
import { median } from './stats';

export const RISE_NOK = 1.0; // a step at least this big between the two windows is a rise
export const BEFORE_H = 4; // window before a candidate step
export const AFTER_H = 3; // window after it
export const MIN_SIDE = 8; // reports needed in each window
export const LOOKBACK_H = 24; // only the latest rise within this many hours counts
const STEP_MS = 30 * 60_000;
const H = 3_600_000;

export interface Rise {
  /** Start of the step, on a 30-minute grid (UTC ISO). */
  at: string;
  /** Median of prices reported in the BEFORE_H hours before `at`. */
  before: number;
  /** Median of prices reported in the AFTER_H hours from `at`. */
  after: number;
  /** Median of every price reported since `at` (null if < MIN_SIDE): drifts down as stations ease off. */
  now: number | null;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The latest rise in the last LOOKBACK_H hours, or null. Candidate steps every 30 minutes; consecutive
 * qualifying steps form one episode, and the step with the biggest jump inside the latest episode wins.
 */
export function detectRise(prices: TimedPrice[], nowMs: number): Rise | null {
  let best: { atMs: number; before: number; after: number; score: number } | null = null;
  let inEpisode = false;
  for (let T = Math.ceil((nowMs - LOOKBACK_H * H) / STEP_MS) * STEP_MS; T <= nowMs; T += STEP_MS) {
    const beforeXs = prices.filter((p) => p.t >= T - BEFORE_H * H && p.t < T).map((p) => p.price);
    const afterXs = prices.filter((p) => p.t >= T && p.t < T + AFTER_H * H).map((p) => p.price);
    const before = median(beforeXs);
    const after = median(afterXs);
    // Medians decide whether there is a rise (robust to odd reports)…
    const ok = before !== null && after !== null && beforeXs.length >= MIN_SIDE && afterXs.length >= MIN_SIDE && after - before >= RISE_NOK;
    if (!ok) {
      inEpisode = false;
      continue;
    }
    if (!inEpisode) best = null; // a later episode replaces an earlier one
    inEpisode = true;
    // …means place it: medians plateau around the true step, means peak at it.
    const score = mean(afterXs) - mean(beforeXs);
    if (!best || score > best.score) best = { atMs: T, before: before!, after: after!, score };
  }
  if (!best) return null;
  const since = prices.filter((p) => p.t >= best!.atMs).map((p) => p.price);
  return {
    at: new Date(best.atMs).toISOString(),
    before: round2(best.before),
    after: round2(best.after),
    now: since.length >= MIN_SIDE ? round2(median(since)!) : null,
  };
}

/** A price reported before the latest rise and at least RISE_NOK below the market since then is out of date. */
export function isOutdated(p: TimedPrice, rise: Rise | null): boolean {
  if (rise === null) return false;
  return p.t < Date.parse(rise.at) && (rise.now ?? rise.after) - p.price >= RISE_NOK;
}
