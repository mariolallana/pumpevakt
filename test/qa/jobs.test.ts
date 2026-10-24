// QA black-box tests for the jobs, scheduled() and GET /health against a spec-schema D1.
// Spec: docs/02 §4, docs/03 (tables, retention), docs/04 shared definitions, docs/05 §2–3, contract.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { runPricesJob } from '../../src/jobs/prices';
import { runMarketJob } from '../../src/jobs/market';
import worker from '../../src/index';
import { CENTRES } from '../../src/sources/drivstoffapp';
import { createQaDb, type QaDb } from './qaDb';
import { fixtures, fakeFetch, json, text, sourcesRouter, syntheticFreshStations, rawStation, apiTs, NOW, OSLO } from './helpers';

let db: QaDb;
beforeAll(async () => { db = await createQaDb(); });
afterAll(async () => { await db.dispose(); });
beforeEach(async () => { await db.reset(); });

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const stdFetch = (byCentre: unknown[][] = [fixtures.realStations, fixtures.adversarialStations, fixtures.realStations]) =>
  fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: byCentre }));
const prices = (sql = '1=1', ...b: unknown[]) =>
  db.all<{ station_id: string; fuel: string; price: number; observed_at: string; source: string }>(`SELECT * FROM prices WHERE ${sql}`, ...b);

describe('QA-JP prices job (docs/02 §4)', () => {
  it('QA-JP-01 run on recorded fixtures: stations upserted, prices inserted, counts returned', async () => {
    const { fn, calls } = stdFetch();
    const r = await runPricesJob(db.env, { fetchFn: fn, now: NOW });
    expect(calls.filter((c) => c.url.hostname === 'backend.drivstoffapp.no')).toHaveLength(3);
    expect(calls.every((c) => c.url.hostname === 'backend.drivstoffapp.no')).toBe(true);
    expect(r.nObs).toBeGreaterThanOrEqual(50);
    expect(r.nChanges).toBe(await db.count('prices'));
    expect(r.nChanges).toBeGreaterThanOrEqual(50);
    expect(await db.count('stations', 'id = ?', 'j1i4da8bf8wkcql')).toBe(1);
    expect(await db.count('stations')).toBeGreaterThanOrEqual(15);
    const s = (await db.all<{ name: string; brand: string; address: string; lat: number; lon: number }>(
      "SELECT * FROM stations WHERE id='j1i4da8bf8wkcql'"))[0]!;
    expect(s).toMatchObject({ name: 'Fredensborg', brand: 'Uno X', address: 'Maridalsveien 10, 0178 Oslo' });
    expect(s.lat).toBeCloseTo(59.9208, 3);
  });

  it('QA-JP-02 every stored price has a station row, source drivstoffapp and ISO-UTC observed_at', async () => {
    const { fn } = stdFetch();
    await runPricesJob(db.env, { fetchFn: fn, now: NOW });
    const ps = await prices();
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) {
      expect(p.source).toBe('drivstoffapp');
      expect(p.observed_at).toMatch(ISO_Z);
    }
    expect(await db.count('prices', 'station_id NOT IN (SELECT id FROM stations)')).toBe(0);
    const d = await prices("station_id='j1i4da8bf8wkcql' AND fuel='diesel'");
    expect(d).toHaveLength(1);
    expect(Date.parse(d[0]!.observed_at)).toBe(Date.parse('2026-10-24T07:26:46Z'));
  });

  it('QA-JP-03 change-only inserts: identical second run inserts nothing', async () => {
    const { fn } = stdFetch();
    await runPricesJob(db.env, { fetchFn: fn, now: NOW });
    const before = await db.count('prices');
    const r2 = await runPricesJob(db.env, { fetchFn: stdFetch().fn, now: new Date(NOW.getTime() + 30 * 60_000) });
    expect(r2.nChanges).toBe(0);
    expect(await db.count('prices')).toBe(before);
  });

  it('QA-JP-04 a price change, or an observed_at change, inserts exactly one row each', async () => {
    const base = [rawStation('qachg1', OSLO.lat, OSLO.lon, { diesel_price: 24.0, gasoline_price: 26.0 }, '2026-10-24 08:00:00.000Z')];
    await runPricesJob(db.env, { fetchFn: stdFetch([base, [], []]).fn, now: NOW });
    expect(await db.count('prices')).toBe(2);
    const priceChanged = [rawStation('qachg1', OSLO.lat, OSLO.lon, { diesel_price: 23.5 }, '2026-10-24 08:00:00.000Z')];
    priceChanged[0]!.prices.gasoline_price = 26.0;
    (priceChanged[0]!.prices.updated_at as Record<string, string>).gasoline_price = '2026-10-24 08:00:00.000Z';
    const r = await runPricesJob(db.env, { fetchFn: stdFetch([priceChanged, [], []]).fn, now: NOW });
    expect(r.nChanges).toBe(1);
    expect(await db.count('prices', "fuel='diesel'")).toBe(2);
    expect(await db.count('prices', "fuel='petrol95'")).toBe(1);
    // same price, re-confirmed later → observed_at changed → one insert (docs/02 §4 "price or observed_at changed")
    const reconfirmed = [rawStation('qachg1', OSLO.lat, OSLO.lon, { diesel_price: 23.5 }, '2026-10-24 09:00:00.000Z')];
    const r3 = await runPricesJob(db.env, { fetchFn: stdFetch([reconfirmed, [], []]).fn, now: NOW });
    expect(r3.nChanges).toBe(1);
    expect(await db.count('prices', "fuel='diesel'")).toBe(3);
  });

  it('QA-JP-05 fd_price is never stored', async () => {
    await runPricesJob(db.env, { fetchFn: stdFetch().fn, now: NOW });
    expect(await db.count('prices', 'price IN (24.74, 22.34, 22.43, 20.0, 19.9)')).toBe(0);
    expect((await prices("station_id='ohbvhgro31z85n3' AND fuel='diesel'"))[0]?.price).toBe(24.58);
    expect(await db.count('prices', "station_id='qafdonly000001'")).toBe(0);
  });

  it('QA-JP-06 implausible prices (2.19, 75) do not fail the run and are not stored (schema CHECK 5..60)', async () => {
    const { fn } = stdFetch();
    await expect(runPricesJob(db.env, { fetchFn: fn, now: NOW })).resolves.toBeTruthy();
    expect(await db.count('prices', 'price < 5 OR price > 60')).toBe(0);
    expect(await db.count('prices', "station_id='j1i4da8bf8wkcql'")).toBe(3); // other rows still stored
  });

  it('QA-JP-07 duplicate station across centres stored once per fuel', async () => {
    await runPricesJob(db.env, { fetchFn: stdFetch().fn, now: NOW });
    expect(await db.count('prices', "station_id='j1i4da8bf8wkcql' AND fuel='diesel'")).toBe(1);
  });

  it('QA-JP-08 station upsert updates changed master data', async () => {
    const a = [rawStation('qaups1', OSLO.lat, OSLO.lon, { diesel_price: 24 }, '2026-10-24 08:00:00.000Z')];
    await runPricesJob(db.env, { fetchFn: stdFetch([a, [], []]).fn, now: NOW });
    const b = [rawStation('qaups1', OSLO.lat + 0.01, OSLO.lon, { diesel_price: 24 }, '2026-10-24 08:00:00.000Z')];
    b[0]!.name = 'Renamed';
    await runPricesJob(db.env, { fetchFn: stdFetch([b, [], []]).fn, now: NOW });
    const rows = await db.all<{ name: string; lat: number }>("SELECT * FROM stations WHERE id='qaups1'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Renamed');
    expect(rows[0]!.lat).toBeCloseTo(OSLO.lat + 0.01, 6);
  });

  it('QA-JP-09 recorded fixture has only 9 fresh diesel stations → level null, no oslo_diesel_median written', async () => {
    const r = await runPricesJob(db.env, { fetchFn: stdFetch().fn, now: NOW });
    expect(r.level).toBeNull();
    expect(await db.count('market_daily', "series='oslo_diesel_median'")).toBe(0);
  });

  it('QA-JP-10 ≥ 30 fresh stations → level computed and today\'s oslo_diesel_median written', async () => {
    const st = syntheticFreshStations(31, NOW, 24);
    const r = await runPricesJob(db.env, { fetchFn: stdFetch([st, [], []]).fn, now: NOW });
    expect(r.level).not.toBeNull();
    expect(r.level!.nFresh).toBe(31);
    expect(r.level!.median).toBeCloseTo(24.15, 6);
    const rows = await db.all<{ day: string; value: number }>("SELECT * FROM market_daily WHERE series='oslo_diesel_median'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.day).toBe('2026-10-24');
    expect(rows[0]!.value).toBeCloseTo(24.15, 6);
  });

  it('QA-JP-11 the stale and far stations are stored but do not count toward the level', async () => {
    const st = [...syntheticFreshStations(29, NOW, 24), ...fixtures.adversarialStations];
    const r = await runPricesJob(db.env, { fetchFn: stdFetch([st, [], []]).fn, now: NOW });
    // fresh in area: 29 synthetic + fdboth(24.10) + Fredensborg (07:26, 2.6 h) = 31; low/high typos are fresh too
    // so nFresh is 31 (typos filtered) or 33 (typos counted); never includes stale (qastale) or far (qafar)
    expect(r.level).not.toBeNull();
    expect([31, 33]).toContain(r.level!.nFresh);
    expect(await db.count('prices', "station_id IN ('qastale0000008','qafar000000009')")).toBe(2);
  });

  it('QA-JP-12 daily level = median of all L values that day (docs/04)', async () => {
    const t1 = new Date('2026-10-24T08:00:00Z'), t2 = new Date('2026-10-24T08:30:00Z'), t3 = new Date('2026-10-24T09:00:00Z');
    await runPricesJob(db.env, { fetchFn: stdFetch([syntheticFreshStations(30, t1, 24.0)]).fn, now: t1 }); // L = 24.145
    await runPricesJob(db.env, { fetchFn: stdFetch([syntheticFreshStations(30, t2, 25.0)]).fn, now: t2 }); // L = 25.145
    await runPricesJob(db.env, { fetchFn: stdFetch([syntheticFreshStations(30, t3, 30.0)]).fn, now: t3 }); // L = 30.145
    const rows = await db.all<{ value: number }>("SELECT value FROM market_daily WHERE series='oslo_diesel_median' AND day='2026-10-24'");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBeCloseTo(25.145, 6); // median(24.145, 25.145, 30.145)
  });

  it('QA-JP-13 drivstoffapp down → run reported as failed (rejects, or resolves with error + runs ok=0), no price rows', async () => {
    const { fn } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: [], failDrivstoffapp: true }));
    const r = await runPricesJob(db.env, { fetchFn: fn, now: NOW }).then((v) => v as { error?: string }, (e) => ({ error: String(e) }));
    expect(r.error).toBeTruthy();
    expect(await db.count('prices')).toBe(0);
  });

  it('QA-JP-14 source format change (non-array body) is a FAILED run, not a silent empty success (docs/09, PRD §5)', async () => {
    const { fn } = fakeFetch((c) => (c.url.hostname === 'backend.drivstoffapp.no' ? json({ items: fixtures.realStations }) : undefined));
    const r = await runPricesJob(db.env, { fetchFn: fn, now: NOW }).then((v) => v as { error?: string }, (e) => ({ error: String(e) }));
    const rows = await db.all<{ ok: number }>("SELECT ok FROM runs WHERE job='prices'");
    expect(r.error, 'job reported success on an unrecognised response').toBeTruthy();
    if (rows.length) expect(rows.at(-1)!.ok).toBe(0);
  });

  it('QA-JP-15 renamed fields (array, but nothing mappable from 15 stations) is a FAILED run', async () => {
    const renamed = fixtures.realStations.map((s: any) => ({ ...s, prices: undefined, fuel_prices: s.prices }));
    const { fn } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: [renamed, renamed, renamed] }));
    const r = await runPricesJob(db.env, { fetchFn: fn, now: NOW }).then((v) => v as { error?: string }, (e) => ({ error: String(e) }));
    expect(r.error, 'job reported success with 0 observations from a non-empty response').toBeTruthy();
  });

  it('QA-JP-16 full-size run (3 × 100 live-shaped stations) stores every observation', async () => {
    const mk = (k: number) => Array.from({ length: 100 }, (_, i) => {
      const s = JSON.parse(JSON.stringify(fixtures.realStations[i % 15])); s.id = `big${k}_${i}`; return s;
    });
    const r = await runPricesJob(db.env, { fetchFn: stdFetch([mk(0), mk(1), mk(2)]).fn, now: NOW });
    expect((r as { error?: string }).error).toBeUndefined();
    expect(await db.count('stations')).toBe(300);
    expect(await db.count('prices')).toBe(r.nChanges);
    expect(r.nChanges).toBe(r.nObs);
    expect(r.nObs).toBeGreaterThan(800);
  });
});

describe('QA-JM market job (docs/01 §3, docs/03 retention)', () => {
  const series = async (s: string) => db.count('market_daily', 'series = ?', s);

  it('QA-JM-01 stores ULSD, USD/NOK and WDI daily series from the fixtures', async () => {
    const { fn, calls } = fakeFetch(sourcesRouter({ centres: [], stationsByCentre: [] }));
    const r = await runMarketJob(db.env, { fetchFn: fn, now: NOW });
    expect(calls.map((c) => c.url.hostname).sort()).toEqual(['data.norges-bank.no', 'fred.stlouisfed.org']);
    expect(calls.find((c) => c.url.hostname === 'fred.stlouisfed.org')!.url.searchParams.get('id')).toBe('DDFUELNYH');
    expect(await series('wdi_nok_l')).toBeGreaterThan(0);
    expect(await series('ulsd_usd_gal')).toBeGreaterThan(0);
    expect(await series('usdnok')).toBeGreaterThan(0);
    expect(r.nPoints).toBeGreaterThan(0);
    const w = await db.all<{ value: number }>("SELECT value FROM market_daily WHERE series='wdi_nok_l' AND day='2026-10-20'");
    expect(w[0]!.value).toBeCloseTo((5.265 / 3.78541) * 9.3843, 6);
    // 2026-10-19 (Monday) uses that day's FX; check a FRED day with FX carried forward is consistent
    const days = await db.all<{ day: string }>("SELECT day FROM market_daily WHERE series='wdi_nok_l' ORDER BY day");
    for (const d of days) expect(d.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('QA-JM-02 idempotent: a second run does not duplicate or fail', async () => {
    await runMarketJob(db.env, { fetchFn: fakeFetch(sourcesRouter({ centres: [], stationsByCentre: [] })).fn, now: NOW });
    const n = await db.count('market_daily');
    await runMarketJob(db.env, { fetchFn: fakeFetch(sourcesRouter({ centres: [], stationsByCentre: [] })).fn, now: NOW });
    expect(await db.count('market_daily')).toBe(n);
  });

  it('QA-JM-03 prunes runs older than 30 days, keeps recent ones', async () => {
    const ago = (d: number) => new Date(NOW.getTime() - d * 86400_000).toISOString();
    for (const [d, id] of [[45, 1], [31, 2], [29, 3], [1, 4]] as const) {
      await db.DB.prepare('INSERT INTO runs (id, job, started_at, finished_at, ok, detail) VALUES (?, ?, ?, ?, 1, ?)')
        .bind(id, 'prices', ago(d), ago(d), '{}').run();
    }
    await runMarketJob(db.env, { fetchFn: fakeFetch(sourcesRouter({ centres: [], stationsByCentre: [] })).fn, now: NOW });
    const ids = (await db.all<{ id: number }>('SELECT id FROM runs WHERE id <= 4 ORDER BY id')).map((r) => r.id);
    expect(ids).toEqual([3, 4]);
  });

  it('QA-JM-04 does not touch oslo_diesel_median', async () => {
    await db.DB.prepare("INSERT INTO market_daily VALUES ('2026-10-23','oslo_diesel_median',24.3)").run();
    await runMarketJob(db.env, { fetchFn: fakeFetch(sourcesRouter({ centres: [], stationsByCentre: [] })).fn, now: NOW });
    expect(await series('oslo_diesel_median')).toBe(1);
  });

  it('QA-JM-05 FRED/Norges Bank down → run reported as failed, nothing written', async () => {
    const { fn } = fakeFetch(sourcesRouter({ centres: [], stationsByCentre: [], failMarket: true }));
    const r = await runMarketJob(db.env, { fetchFn: fn, now: NOW }).then((v) => v as { error?: string }, (e) => ({ error: String(e) }));
    expect(r.error).toBeTruthy();
    expect(await db.count('market_daily')).toBe(0);
  });

  it('QA-JM-06 FRED answers 200 with an HTML page → failed run', async () => {
    const { fn } = fakeFetch((c) => (c.url.hostname === 'fred.stlouisfed.org' ? text('<html>maintenance</html>') : sourcesRouter({ centres: [], stationsByCentre: [] })(c)));
    const r = await runMarketJob(db.env, { fetchFn: fn, now: NOW }).then((v) => v as { error?: string }, (e) => ({ error: String(e) }));
    expect(r.error).toBeTruthy();
  });
});

describe('QA-SCH scheduled() + runs log (docs/02 §4.5, docs/05 §3)', () => {
  const ctx = () => {
    const ps: Promise<unknown>[] = [];
    return { c: { waitUntil: (p: Promise<unknown>) => void ps.push(p), passThroughOnException() {} } as any, ps };
  };
  async function fire(cron: string, route: ReturnType<typeof sourcesRouter>) {
    const { fn, calls } = fakeFetch(route);
    vi.stubGlobal('fetch', fn);
    const { c, ps } = ctx();
    let threw = false;
    try {
      await worker.scheduled!({ cron, scheduledTime: NOW.getTime(), type: 'scheduled', noRetry() {} } as any, db.env, c);
    } catch { threw = true; }
    await Promise.allSettled(ps);
    return { calls, threw };
  }
  afterEach(() => { vi.unstubAllGlobals(); });
  const runs = () => db.all<{ job: string; ok: number; started_at: string; finished_at: string | null; detail: string | null }>('SELECT * FROM runs ORDER BY id');

  it("QA-SCH-01 '*/30 * * * *' runs the prices job only and writes a runs row ok=1", async () => {
    const { calls } = await fire('*/30 * * * *', sourcesRouter({ centres: CENTRES, stationsByCentre: [fixtures.realStations, [], []] }));
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.url.hostname === 'backend.drivstoffapp.no')).toBe(true);
    const r = await runs();
    expect(r).toHaveLength(1);
    expect(r[0]!.job).toBe('prices');
    expect(r[0]!.ok).toBe(1);
    expect(r[0]!.started_at).toMatch(ISO_Z);
    expect(r[0]!.finished_at).toMatch(ISO_Z);
    expect(() => JSON.parse(r[0]!.detail ?? 'null')).not.toThrow();
    expect(await db.count('prices')).toBeGreaterThan(0);
  });

  it("QA-SCH-02 '30 6 * * *' runs the market job only and writes a runs row ok=1", async () => {
    const { calls } = await fire('30 6 * * *', sourcesRouter({ centres: CENTRES, stationsByCentre: [[], [], []] }));
    expect(calls.map((c) => c.url.hostname).sort()).toEqual(['data.norges-bank.no', 'fred.stlouisfed.org']);
    const r = await runs();
    expect(r).toHaveLength(1);
    expect(r[0]!.job).toBe('market');
    expect(r[0]!.ok).toBe(1);
  });

  it('QA-SCH-03 failed prices run still writes a runs row with ok=0 and the error in detail', async () => {
    await fire('*/30 * * * *', sourcesRouter({ centres: CENTRES, stationsByCentre: [], failDrivstoffapp: true }));
    const r = await runs();
    expect(r).toHaveLength(1);
    expect(r[0]!.job).toBe('prices');
    expect(r[0]!.ok).toBe(0);
    expect(r[0]!.finished_at).toMatch(ISO_Z);
    expect(r[0]!.detail ?? '').not.toBe('');
  });

  it('QA-SCH-04 failed market run writes a runs row with ok=0', async () => {
    await fire('30 6 * * *', sourcesRouter({ centres: CENTRES, stationsByCentre: [], failMarket: true }));
    const r = await runs();
    expect(r).toHaveLength(1);
    expect(r[0]!.job).toBe('market');
    expect(r[0]!.ok).toBe(0);
  });
});

describe('QA-HTTP fetch() routes (docs/05 §2)', () => {
  const get = (path: string) => worker.fetch!(new Request(`https://pumpevakt.example${path}`) as any, db.env, { waitUntil() {}, passThroughOnException() {} } as any);

  it('QA-HTTP-01 GET /health with no runs → 200 JSON with jobs.prices and jobs.market', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/json/);
    const b = (await res.json()) as any;
    expect(b).toHaveProperty('jobs.prices');
    expect(b).toHaveProperty('jobs.market');
  });

  it('QA-HTTP-02 /health shape {jobs:{prices:{lastOk,lastError,nFresh},market:{…}}} after runs', async () => {
    const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    await db.DB.prepare('INSERT INTO runs (job, started_at, finished_at, ok, detail) VALUES (?,?,?,?,?)').bind('prices', ago(60), ago(60), 1, JSON.stringify({ nObs: 200, nFresh: 57 })).run();
    await db.DB.prepare('INSERT INTO runs (job, started_at, finished_at, ok, detail) VALUES (?,?,?,?,?)').bind('prices', ago(30), ago(30), 0, JSON.stringify({ error: 'HTTP 503' })).run();
    await db.DB.prepare('INSERT INTO runs (job, started_at, finished_at, ok, detail) VALUES (?,?,?,?,?)').bind('market', ago(120), ago(120), 1, '{}').run();
    const b = (await (await get('/health')).json()) as any;
    for (const k of ['lastOk', 'lastError', 'nFresh']) expect(b.jobs.prices).toHaveProperty(k);
    expect(b.jobs.market).toHaveProperty('lastOk');
    expect(b.jobs.market).toHaveProperty('lastError');
    expect(typeof b.jobs.prices.lastOk).toBe('string');
    expect(Date.parse(b.jobs.prices.lastOk)).toBeGreaterThan(Date.now() - 2 * 3600_000);
    expect(b.jobs.prices.lastError).toBeTruthy();
    expect(typeof b.jobs.market.lastOk).toBe('string');
  });

  it('QA-HTTP-04 end-to-end: after a real prices run (≥30 fresh) /health reports lastOk and numeric nFresh', async () => {
    const now = new Date();
    await runPricesJob(db.env, { fetchFn: stdFetch([syntheticFreshStations(32, now, 24), [], []]).fn, now });
    const b = (await (await get('/health')).json()) as any;
    expect(typeof b.jobs.prices.lastOk).toBe('string');
    expect(b.jobs.prices.nFresh).toBe(32);
    expect(b.jobs.prices.lastError ?? null).toBeNull();
  });

  it('QA-HTTP-03 unknown route → 404; GET /health exposes no personal data', async () => {
    expect((await get('/nope')).status).toBe(404);
    const t = await (await get('/health')).text();
    expect(t).not.toMatch(/59\.93|10\.80|123456789/);
  });
});

describe('QA-PERF indicative CPU budget (docs/02 §5) — Node, not workerd', () => {
  it('QA-PERF-01 parse + map + dedupe of 3 × 100 live-shaped stations', async () => {
    const { mapStations, dedupeObs } = await import('../../src/sources/drivstoffapp');
    const mk = (k: number) => JSON.stringify(Array.from({ length: 100 }, (_, i) => {
      const s = JSON.parse(JSON.stringify(fixtures.realStations[i % 15])); s.id = `perf${k}_${i}`; return s;
    }));
    const bodies = [mk(0), mk(1), mk(2)];
    const times: number[] = [];
    for (let rep = 0; rep < 7; rep++) {
      const t0 = performance.now();
      dedupeObs(bodies.map((b) => mapStations(JSON.parse(b))));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.info(`[QA-PERF-01] payload ${(bodies[0]!.length / 1024).toFixed(0)} KB ×3, median ${times[3]!.toFixed(2)} ms, best ${times[0]!.toFixed(2)} ms`);
    expect(times[3]!).toBeLessThan(50); // gross-regression guard only; Node timing ≠ workerd CPU time
  });
});

// keep helper import used (apiTs exported for fixture authors)
void apiTs;
