// Prices job, every 30 min (docs/02 §4 steps 1–3 and 5; step 4 "signals" is Phase 3).
import { changedObs, uniqueStations } from '../core/changes';
import { osloLevel, type OsloLevel } from '../core/osloLevel';
import { median } from '../core/stats';
import { osloDate } from '../core/time';
import { finishRun, insertPrices, latestPrices, recentOkPriceRuns, recordFailure, startRun, upsertMarket, upsertStations } from '../db';
import { fetchDrivstoffapp } from '../sources/drivstoffapp';
import type { Env } from '../types';

export const OSLO_MEDIAN_SERIES = 'oslo_diesel_median';

export interface PricesResult {
  nObs: number;
  nChanges: number;
  level: OsloLevel | null;
  /** Set when the run failed (the failure is also recorded in `runs`). The job never throws. */
  error?: string;
}

/**
 * 1. fetch 3 centres → 2. upsert stations, append changed prices → 3. Oslo level L, and today's
 * oslo_diesel_median = median of every L recorded today (Europe/Oslo date) → 5. runs row.
 *
 * Each run's L is kept in its runs.detail (`level`), so the daily median is recomputed exactly
 * from today's successful runs without an extra table (see docs/spec-flaws-impl.md IMPL-3).
 */
export async function runPricesJob(env: Env, deps: { fetchFn?: typeof fetch; now?: Date } = {}): Promise<PricesResult> {
  const now = deps.now ?? new Date();
  const t0 = Date.now();
  const startedAt = now.toISOString();
  const finishedAt = () => new Date(now.getTime() + (Date.now() - t0)).toISOString();
  let runId: number | null = null;
  try {
    runId = await startRun(env.DB, 'prices', startedAt);

    const obs = await fetchDrivstoffapp(deps.fetchFn ?? fetch);
    // Oslo never has zero priced stations; an all-empty answer is an outage, not a quiet success.
    if (obs.length === 0) throw new Error('drivstoffapp returned no observations for any centre');
    const stations = uniqueStations(obs);
    await upsertStations(env.DB, stations);
    const changes = changedObs(obs, await latestPrices(env.DB));
    await insertPrices(env.DB, changes);

    const level = osloLevel(obs, now);
    let dayMedian: number | null = null;
    const today = osloDate(now);
    if (level) {
      // Earlier successful runs today (look back 26 h in UTC, then filter by Oslo date) + this run.
      const since = new Date(now.getTime() - 26 * 3_600_000).toISOString();
      const earlier = (await recentOkPriceRuns(env.DB, since))
        .filter((r) => osloDate(new Date(r.startedAt)) === today && typeof r.detail.level === 'number')
        .map((r) => r.detail.level as number);
      dayMedian = median([...earlier, level.median]);
      await upsertMarket(env.DB, [{ day: today, series: OSLO_MEDIAN_SERIES, value: dayMedian! }]);
    }

    const detail = {
      nObs: obs.length,
      nStations: stations.length,
      nChanges: changes.length,
      nFresh: level?.nFresh ?? 0,
      level: level?.median ?? null,
      dayMedian,
      day: today,
      ms: Date.now() - t0,
    };
    await finishRun(env.DB, runId, true, detail, finishedAt());
    console.log(`prices ok ${JSON.stringify(detail)}`);
    return { nObs: obs.length, nChanges: changes.length, level };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`prices job failed: ${error}`);
    // TODO(phase 2): two consecutive failed runs → Telegram ⚠️ ping (docs/02 §4 step 5).
    await recordFailure(env.DB, runId, 'prices', startedAt, { error, ms: Date.now() - t0 }, finishedAt());
    return { nObs: 0, nChanges: 0, level: null, error };
  }
}
