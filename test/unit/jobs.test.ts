import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import nearby from './fixtures/drivstoffapp-nearby.json';
import fredCsv from './fixtures/fred-ddfuelnyh.csv?raw';
import nbCsv from './fixtures/norgesbank-usdnok.csv?raw';
import { runPricesJob, OSLO_MEDIAN_SERIES } from '../../src/jobs/prices';
import { runMarketJob } from '../../src/jobs/market';
import worker from '../../src/index';
import { MARKET_CRON, PRICES_CRON } from '../../src/routes';
import { createTestDb, fakeFetch, freshStations, rawStation, rows } from './helpers';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.dispose();
});
beforeEach(async () => {
  await t.reset();
  vi.restoreAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const NOW = new Date('2026-10-24T10:00:00.000Z'); // 12:00 Oslo
const later = (min: number) => new Date(NOW.getTime() + min * 60_000);
const drv = (body: unknown) => fakeFetch((url) => (url.includes('drivstoffapp') ? body : new Error(`unexpected ${url}`)));
const count = async (table: string, where = '1=1') => (await rows<{ n: number }>(t.db, `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!.n;
const runsOf = (job: string) => rows<{ ok: number | null; detail: string; started_at: string; finished_at: string }>(t.db, `SELECT * FROM runs WHERE job = ? ORDER BY id`, job);

describe('prices job', () => {
  it('first run on the recorded fixture: stations upserted, all prices inserted, runs row ok', async () => {
    const r = await runPricesJob(t.env, { fetchFn: drv(nearby).fetchFn, now: NOW });
    expect(r).toEqual({ nObs: 45, nChanges: 45, level: null }); // only 13 diesel -> below the 30 coverage guard
    expect(await count('stations')).toBe(15);
    expect(await count('prices')).toBe(45);
    expect(await count('prices', "source = 'drivstoffapp'")).toBe(45);
    expect(await count('market_daily')).toBe(0); // no level -> no daily median
    const [run] = await runsOf('prices');
    expect(run!.ok).toBe(1);
    expect(run!.started_at).toBe(NOW.toISOString());
    expect(JSON.parse(run!.detail)).toMatchObject({ nObs: 45, nChanges: 45, nFresh: 0, level: null });
  });

  it('identical second run inserts nothing; a changed price or observed_at inserts one row each', async () => {
    const ts = '2026-10-24 08:00:00.000Z';
    const v1 = [rawStation('a', 59.91, 10.75, { diesel_price: 24, gasoline_price: 26 }, ts)];
    await runPricesJob(t.env, { fetchFn: drv(v1).fetchFn, now: NOW });
    expect((await runPricesJob(t.env, { fetchFn: drv(v1).fetchFn, now: later(30) })).nChanges).toBe(0);

    const v2 = [rawStation('a', 59.91, 10.75, { diesel_price: 23.5, gasoline_price: 26 }, ts)];
    expect((await runPricesJob(t.env, { fetchFn: drv(v2).fetchFn, now: later(60) })).nChanges).toBe(1);

    const v3 = [rawStation('a', 59.91, 10.75, { diesel_price: 23.5, gasoline_price: 26 }, ts)];
    (v3[0]!.prices.updated_at as Record<string, string>).diesel_price = '2026-10-24 09:00:00.000Z';
    expect((await runPricesJob(t.env, { fetchFn: drv(v3).fetchFn, now: later(90) })).nChanges).toBe(1);

    expect(await count('prices', "fuel = 'diesel'")).toBe(3);
    expect(await count('prices', "fuel = 'petrol95'")).toBe(1);
  });

  it('station upsert updates name/brand/address/coords', async () => {
    const ts = '2026-10-24 08:00:00.000Z';
    await runPricesJob(t.env, { fetchFn: drv([rawStation('a', 59.91, 10.75, { diesel_price: 24 }, ts)]).fetchFn, now: NOW });
    const renamed = [{ ...rawStation('a', 59.92, 10.76, { diesel_price: 24 }, ts), name: 'Renamed', brand: 'Circle K' }];
    await runPricesJob(t.env, { fetchFn: drv(renamed).fetchFn, now: later(30) });
    const [s] = await rows<{ name: string; brand: string; lat: number }>(t.db, 'SELECT * FROM stations');
    expect(s).toMatchObject({ name: 'Renamed', brand: 'Circle K', lat: 59.92 });
    expect(await count('stations')).toBe(1);
  });

  it('Oslo level -> oslo_diesel_median = median of all levels that Oslo day', async () => {
    const r1 = await runPricesJob(t.env, { fetchFn: drv(freshStations(31, NOW, 24)).fetchFn, now: NOW });
    expect(r1.level).toEqual({ median: 25.5, nFresh: 31 }); // 24.0 .. 27.0
    const md = () => rows<{ day: string; value: number }>(t.db, `SELECT day, value FROM market_daily WHERE series = ?`, OSLO_MEDIAN_SERIES);
    expect(await md()).toEqual([{ day: '2026-10-24', value: 25.5 }]);

    await runPricesJob(t.env, { fetchFn: drv(freshStations(31, later(30), 26)).fetchFn, now: later(30) }); // level 27.5
    expect((await md())[0]!.value).toBeCloseTo(26.5, 9);
    await runPricesJob(t.env, { fetchFn: drv(freshStations(31, later(60), 20)).fetchFn, now: later(60) }); // level 21.5
    expect((await md())[0]!.value).toBeCloseTo(25.5, 9); // median(25.5, 27.5, 21.5)

    // 22:30Z on 24 Oct = 00:30 on 25 Oct in Oslo (CEST) -> a new day row
    const nextDay = new Date('2026-10-24T22:30:00.000Z');
    await runPricesJob(t.env, { fetchFn: drv(freshStations(31, nextDay, 22)).fetchFn, now: nextDay });
    expect(await md()).toEqual([
      { day: '2026-10-24', value: 25.5 },
      { day: '2026-10-25', value: 23.5 },
    ]);
  });

  it('failure (HTTP 503): runs row ok=0 with error, no prices, job does not throw', async () => {
    const { fetchFn } = fakeFetch(() => new Response('down', { status: 503 }));
    const r = await runPricesJob(t.env, { fetchFn, now: NOW });
    expect(r.error).toMatch(/503/);
    expect(r).toMatchObject({ nObs: 0, nChanges: 0, level: null });
    expect(await count('prices')).toBe(0);
    const [run] = await runsOf('prices');
    expect(run!.ok).toBe(0);
    expect(JSON.parse(run!.detail).error).toMatch(/503/);
    expect(run!.finished_at).toBeTruthy();
  });

  it('all centres empty is a failed run', async () => {
    const r = await runPricesJob(t.env, { fetchFn: drv([]).fetchFn, now: NOW });
    expect(r.error).toBeTruthy();
    expect((await runsOf('prices'))[0]!.ok).toBe(0);
  });
});

describe('market job', () => {
  const marketFetch = () =>
    fakeFetch((url) => (url.includes('fred.stlouisfed.org') ? fredCsv : url.includes('norges-bank') ? nbCsv : new Error(`unexpected ${url}`)));

  it('stores ULSD, USD/NOK and WDI; runs row ok', async () => {
    const r = await runMarketJob(t.env, { fetchFn: marketFetch().fetchFn, now: NOW });
    const series = await rows<{ series: string; n: number }>(t.db, 'SELECT series, COUNT(*) AS n FROM market_daily GROUP BY series ORDER BY series');
    // WDI only for ULSD days on/after the first FX day in the fixture (2026-09-14)
    const nWdi = series.find((s) => s.series === 'wdi_nok_l')!.n;
    expect(series).toEqual([
      { series: 'ulsd_usd_gal', n: 35 },
      { series: 'usdnok', n: 30 },
      { series: 'wdi_nok_l', n: nWdi },
    ]);
    expect(nWdi).toBeGreaterThan(20);
    expect(r).toEqual({ nPoints: 35 + 30 + nWdi });
    const [w] = await rows<{ value: number }>(t.db, "SELECT value FROM market_daily WHERE series = 'wdi_nok_l' AND day = '2026-10-20'");
    expect(w!.value).toBeCloseTo((5.265 / 3.78541) * 9.3843, 9); // ULSD and USD/NOK of 2026-10-20 (~13.05 NOK/L)
    expect((await runsOf('market'))[0]!.ok).toBe(1);
  });

  it('is idempotent (upsert) and prunes runs older than 30 days', async () => {
    await t.db.prepare(`INSERT INTO runs (job, started_at, ok) VALUES ('prices', '2026-09-01T00:00:00.000Z', 1), ('prices', '2026-10-01T00:00:00.000Z', 1)`).run();
    await runMarketJob(t.env, { fetchFn: marketFetch().fetchFn, now: NOW });
    const n1 = await count('market_daily');
    await runMarketJob(t.env, { fetchFn: marketFetch().fetchFn, now: NOW });
    expect(await count('market_daily')).toBe(n1);
    expect(await count('runs', "started_at < '2026-09-24'")).toBe(0);
    expect(await count('runs', "started_at = '2026-10-01T00:00:00.000Z'")).toBe(1);
  });

  it('a failing source -> ok=0 row, nothing written, no throw', async () => {
    const { fetchFn } = fakeFetch((url) => (url.includes('fred') ? new Response('', { status: 500 }) : nbCsv));
    const r = await runMarketJob(t.env, { fetchFn, now: NOW });
    expect(r.nPoints).toBe(0);
    expect(r.error).toMatch(/500/);
    expect(await count('market_daily')).toBe(0);
    expect((await runsOf('market'))[0]!.ok).toBe(0);
  });

  it('FRED answering HTML (no rows) is a failure', async () => {
    const { fetchFn } = fakeFetch((url) => (url.includes('fred') ? '<html>maintenance</html>' : nbCsv));
    expect((await runMarketJob(t.env, { fetchFn, now: NOW })).error).toMatch(/no ULSD/);
  });
});

describe('worker entry', () => {
  const ctx = () => {
    const ps: Promise<unknown>[] = [];
    return { c: { waitUntil: (p: Promise<unknown>) => ps.push(p), passThroughOnException() {} } as unknown as ExecutionContext, ps };
  };

  it('scheduled dispatches both crons and each writes a runs row', async () => {
    vi.stubGlobal(
      'fetch',
      fakeFetch((url) => (url.includes('drivstoffapp') ? nearby : url.includes('fred') ? fredCsv : nbCsv)).fetchFn,
    );
    try {
      for (const cron of [PRICES_CRON, MARKET_CRON]) {
        const { c, ps } = ctx();
        await worker.scheduled({ cron, scheduledTime: Date.now(), noRetry() {} } as ScheduledController, t.env, c);
        await Promise.all(ps);
      }
    } finally {
      vi.unstubAllGlobals();
    }
    expect((await runsOf('prices')).map((r) => r.ok)).toEqual([1]);
    expect((await runsOf('market')).map((r) => r.ok)).toEqual([1]);
  });

  it('entry module exports only the default handler (workerd rejects other named exports)', async () => {
    expect(Object.keys(await import('../../src/index'))).toEqual(['default']);
  });

  it('GET /health reports last run per job; other paths 404', async () => {
    await runPricesJob(t.env, { fetchFn: drv(freshStations(31, NOW)).fetchFn, now: NOW });
    await runMarketJob(t.env, { fetchFn: fakeFetch(() => new Response('', { status: 502 })).fetchFn, now: later(1) });
    const res = await worker.fetch(new Request('https://x.example/health'), t.env, ctx().c);
    expect(res.status).toBe(200);
    const b = (await res.json()) as { jobs: Record<string, Record<string, unknown>> };
    expect(b.jobs.prices).toMatchObject({ lastRun: { ok: true }, lastError: null, consecutiveFailures: 0, nFresh: 31, level: 25.5 });
    expect(typeof b.jobs.prices!.lastOk).toBe('string');
    expect(b.jobs.market).toMatchObject({ lastRun: { ok: false }, lastOk: null, consecutiveFailures: 1 });
    expect((b.jobs.market!.lastError as { error: string }).error).toMatch(/502/);

    expect((await worker.fetch(new Request('https://x.example/'), t.env, ctx().c)).status).toBe(404);
    expect((await worker.fetch(new Request('https://x.example/health', { method: 'POST' }), t.env, ctx().c)).status).toBe(404);
  });
});
