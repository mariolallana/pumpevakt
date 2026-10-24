// Handlers behind the Worker entry. Kept out of src/index.ts because the entry module may only
// export handlers: workerd rejects plain named exports such as string constants.
import { deliverPending, healthStillFailing, raiseHealthAlert } from './alerts';
import { handleApi } from './api';
import { handleFeedback } from './feedback';
import { handleOwner } from './owner';
import { jobHealth } from './core/health';
import { recentRuns } from './db';
import { runMarketJob } from './jobs/market';
import { runPricesJob } from './jobs/prices';
import type { Env } from './types';

export const PRICES_CRON = '*/30 * * * *';
export const MARKET_CRON = '30 6 * * *';

/** GET /health body (docs/05 §2). */
export async function healthBody(env: Env): Promise<unknown> {
  const [prices, market] = await Promise.all([recentRuns(env.DB, 'prices'), recentRuns(env.DB, 'market')]);
  return {
    jobs: {
      prices: jobHealth(prices, ['nFresh', 'nObs', 'level', 'dayMedian']),
      market: jobHealth(market, ['nPoints', 'lastWdi']),
    },
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function handleFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/api/feedback') {
    if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'use POST' } }, 405);
    return handleFeedback(request, env);
  }
  const owner = await handleOwner(request, env);
  if (owner) return owner;
  const api = await handleApi(request, env);
  if (api) return api;
  if (request.method === 'GET' && url.pathname === '/health') {
    try {
      return json(await healthBody(env));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }
  // Static files (web/dist) are served by Workers static assets before the Worker runs (wrangler.toml
  // [assets]); only /api/*, /health and non-navigation asset misses reach this point.
  return new Response('Not found', { status: 404 });
}

/** Dispatch by cron expression. Jobs never throw; they log and write a failed `runs` row instead. */
export async function runScheduled(cron: string, env: Env, now = new Date()): Promise<void> {
  const job = cron === PRICES_CRON ? 'prices' : cron === MARKET_CRON ? 'market' : null;
  if (job === 'prices') await runPricesJob(env, { now });
  else if (job === 'market') await runMarketJob(env, { now });
  else return console.warn(`unknown cron "${cron}", nothing to do`);
  // Alerts after the job, kept apart so a broken alert path can never break data collection.
  try {
    await raiseHealthAlert(env, job, now);
    const d = await deliverPending(env, { now, revalidate: (a) => healthStillFailing(env, a) });
    if (d.sent + d.held + d.shadow + d.dropped > 0) console.log(`alerts ${JSON.stringify(d)}`);
  } catch (e) {
    console.error(`alerts failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
