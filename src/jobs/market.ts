// Market job, daily 06:30 UTC: FRED ULSD + Norges Bank USD/NOK → WDI (docs/01 §3). Also prunes `runs` (docs/03 retention)
// and records each chain's morning price level for the last CHAIN_DAYS full days (F23; re-run safe, fills gaps).
import { amLevels } from '../core/chains';
import { osloDate } from '../core/time';
import { computeWdi } from '../core/wdi';
import { brandedReportsSince, finishRun, pruneRuns, recordFailure, startRun, upsertMarket } from '../db';
import { fetchFred } from '../sources/fred';
import { fetchUsdNok } from '../sources/norgesBank';
import type { Env } from '../types';

export const ULSD_FRED_ID = 'DDFUELNYH';
export const ULSD_SERIES = 'ulsd_usd_gal';
export const RUNS_RETENTION_DAYS = 30;
export const CHAIN_DAYS = 7;

export interface MarketResult {
  nPoints: number;
  /** Set when the run failed (also recorded in `runs`). The job never throws. */
  error?: string;
}

export async function runMarketJob(env: Env, deps: { fetchFn?: typeof fetch; now?: Date } = {}): Promise<MarketResult> {
  const now = deps.now ?? new Date();
  const fetchFn = deps.fetchFn ?? fetch;
  const t0 = Date.now();
  const startedAt = now.toISOString();
  const finishedAt = () => new Date(now.getTime() + (Date.now() - t0)).toISOString();
  let runId: number | null = null;
  try {
    runId = await startRun(env.DB, 'market', startedAt);
    // Chain levels come from our own stored reports, so they don't depend on FRED/Norges Bank being up.
    const reports = await brandedReportsSince(env.DB, new Date(now.getTime() - (CHAIN_DAYS + 1) * 86_400_000).toISOString());
    const chainPoints = Array.from({ length: CHAIN_DAYS }, (_, i) => amLevels(reports, osloDate(new Date(now.getTime() - (i + 1) * 86_400_000)))).flat();
    await upsertMarket(env.DB, chainPoints);
    const [ulsd, usdnok] = await Promise.all([fetchFred(ULSD_FRED_ID, ULSD_SERIES, fetchFn, { now }), fetchUsdNok(fetchFn)]);
    if (ulsd.length === 0) throw new Error('FRED returned no ULSD observations');
    if (usdnok.length === 0) throw new Error('Norges Bank returned no USD/NOK observations');
    const wdi = computeWdi(ulsd, usdnok);
    const points = [...ulsd, ...usdnok, ...wdi];
    await upsertMarket(env.DB, points);
    const pruned = await pruneRuns(env.DB, new Date(now.getTime() - RUNS_RETENTION_DAYS * 86_400_000).toISOString());
    const last = wdi.at(-1);
    const detail = {
      nPoints: points.length,
      nUlsd: ulsd.length,
      nUsdnok: usdnok.length,
      nWdi: wdi.length,
      nChainPoints: chainPoints.length,
      lastWdi: last ? { day: last.day, value: Math.round(last.value * 1000) / 1000 } : null,
      pruned,
      ms: Date.now() - t0,
    };
    await finishRun(env.DB, runId, true, detail, finishedAt());
    console.log(`market ok ${JSON.stringify(detail)}`);
    return { nPoints: points.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`market job failed: ${error}`);
    // TODO(phase 2): failure ping via Telegram.
    await recordFailure(env.DB, runId, 'market', startedAt, { error, ms: Date.now() - t0 }, finishedAt());
    return { nPoints: 0, error };
  }
}
