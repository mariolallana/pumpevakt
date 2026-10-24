// GET /api/stations and /api/market against a real local D1 (Miniflare), see README.md.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { marketHandler, outlookHandler, stationsHandler } from '../../src/api';
import { netSavingNok } from '../../src/core/netSaving';
import { createTestDb } from './helpers';

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
});

const HOME = { lat: 59.93, lon: 10.8 };
const NOW = new Date('2026-10-24T10:00:00.000Z');
const ago = (h: number, from = NOW) => new Date(from.getTime() - h * 3_600_000).toISOString();
const env = () => ({ ...t.env, HOME_LAT: '59.93', HOME_LON: '10.80', TANK_L: '50', CONSUMPTION_L100: '6.5' });
const url = (q: string) => new URL(`http://x${q}`);
const get = (path: string) => worker.fetch(new Request(`http://x${path}`), env());

async function station(id: string, lat: number, lon: number, brand: string | null = 'Circle K') {
  await t.db.prepare(`INSERT INTO stations (id, name, brand, address, lat, lon) VALUES (?1, ?2, ?3, 'Gate 1', ?4, ?5)`).bind(id, `Stasjon ${id}`, brand, lat, lon).run();
}
async function price(id: string, fuel: string, p: number, at: string) {
  await t.db.prepare(`INSERT INTO prices (station_id, fuel, price, observed_at, source) VALUES (?1, ?2, ?3, ?4, 'drivstoffapp')`).bind(id, fuel, p, at).run();
}
async function okRun(startedAt: string, detail: Record<string, unknown>) {
  await t.db.prepare(`INSERT INTO runs (job, started_at, finished_at, ok, detail) VALUES ('prices', ?1, ?1, 1, ?2)`).bind(startedAt, JSON.stringify(detail)).run();
}

describe('GET /api/stations', () => {
  it('latest price per station for the fuel, ≤ 24 h, within radius, ranked by net saving vs the Oslo level', async () => {
    await station('a', HOME.lat + 0.01, HOME.lon); // ~1.1 km
    await station('b', HOME.lat + 0.03, HOME.lon, null); // ~3.3 km
    await station('old', HOME.lat, HOME.lon + 0.01);
    await station('far', HOME.lat + 0.2, HOME.lon); // ~22 km
    await price('a', 'diesel', 25, ago(10)); // superseded
    await price('a', 'diesel', 23.5, ago(1));
    await price('a', 'petrol95', 21, ago(1));
    await price('b', 'diesel', 22.9, ago(7)); // stale but kept
    await price('old', 'diesel', 20, ago(25)); // excluded
    await price('far', 'diesel', 20, ago(1)); // out of radius
    await okRun(ago(0.5), { level: 24, nFresh: 40 });
    await okRun(ago(5), { level: 30, nFresh: 40 }); // older run: ignored

    const r = await stationsHandler(url('/api/stations?lat=59.93&lon=10.8'), env(), NOW);
    expect(r).toMatchObject({ fuel: 'diesel', origin: HOME, radiusKm: 10, refPrice: 24, generatedAt: NOW.toISOString() });
    // b saves more (42 vs 21 kr) but is stale (7 h): fresh rows always come first (IMPL-W12).
    expect(r.stations.map((s) => s.id)).toEqual(['a', 'b']);
    const [a, b] = r.stations;
    expect(a).toMatchObject({ price: 23.5, observedAt: ago(1), ageMinutes: 60, stale: false, brand: 'Circle K', address: 'Gate 1' });
    expect(b).toMatchObject({ price: 22.9, ageMinutes: 420, stale: true, brand: '' });
    expect(a!.netSavingNok).toBe(netSavingNok(24, 23.5, a!.distanceKm, 50, 6.5));
    expect(a!.distanceKm).toBeCloseTo(1.11, 2);
  });

  it('non-diesel fuel uses the fresh median as refPrice; radius widens the set', async () => {
    await station('a', HOME.lat + 0.01, HOME.lon);
    await station('b', HOME.lat + 0.15, HOME.lon); // ~16.7 km
    await price('a', 'petrol95', 21, ago(1));
    await price('b', 'petrol95', 20, ago(1));
    await okRun(ago(0.5), { level: 24, nFresh: 40 });
    const r10 = await stationsHandler(url('/api/stations?fuel=petrol95&lat=59.93&lon=10.8'), env(), NOW);
    expect(r10.refPrice).toBe(21);
    expect(r10.stations.map((s) => s.id)).toEqual(['a']);
    const r20 = await stationsHandler(url('/api/stations?fuel=petrol95&lat=59.93&lon=10.8&radius_km=20'), env(), NOW);
    expect(r20.refPrice).toBe(20.5);
    expect(r20.stations.map((s) => s.id)).toEqual(['a', 'b']); // b is cheaper but its 16.7 km detour costs more
  });

  it('no lat/lon → origin is Oslo S, never HOME (privacy, IMPL-W11)', async () => {
    const res = await get('/api/stations');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).origin).toEqual({ lat: 59.9111, lon: 10.7528 });
    expect(text).not.toContain('59.93');
    expect(text).not.toMatch(/"lon":10\.8[,}]/);
  });

  it('diesel without a level (coverage guard) falls back to the fresh median; no data → refPrice null', async () => {
    await okRun(ago(0.5), { level: null, nFresh: 12 });
    expect((await stationsHandler(url('/api/stations'), env(), NOW)).refPrice).toBeNull();
    await station('a', HOME.lat, HOME.lon);
    await price('a', 'diesel', 22, ago(1));
    expect((await stationsHandler(url('/api/stations'), env(), NOW)).refPrice).toBe(22);
  });

  it('through the Worker: 200 JSON with Cache-Control public, max-age=60', async () => {
    await station('a', HOME.lat, HOME.lon);
    await price('a', 'diesel', 22, new Date(Date.now() - 600_000).toISOString());
    const res = await get('/api/stations?lat=59.93&lon=10.8&radius_km=5&fuel=diesel');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { stations: unknown[]; radiusKm: number };
    expect(body.radiusKm).toBe(5);
    expect(body.stations).toHaveLength(1);
  });

  it.each([
    'lat=59.9',
    'lon=10.7',
    'lat=abc&lon=10',
    'lat=&lon=10',
    'lat=91&lon=10',
    'lat=59&lon=181',
    'radius_km=0',
    'radius_km=-5',
    'radius_km=31',
    'radius_km=ten',
    'fuel=e10',
    'fuel=',
    'fuel=DIESEL',
  ])('400 BAD_INPUT for %s', async (q) => {
    const res = await get(`/api/stations?${q}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('BAD_INPUT');
    expect(body.error.message).toEqual(expect.any(String));
  });

  it('radius_km=30 is accepted (max inclusive)', async () => {
    expect((await get('/api/stations?radius_km=30')).status).toBe(200);
  });
});

describe('GET /api/market', () => {
  it('both series ascending within the last `days` Oslo days, plus the latest ok run', async () => {
    const ins = (day: string, series: string, v: number) =>
      t.db.prepare(`INSERT INTO market_daily (day, series, value) VALUES (?1, ?2, ?3)`).bind(day, series, v).run();
    await ins('2026-10-24', 'oslo_diesel_median', 23.9);
    await ins('2026-10-20', 'oslo_diesel_median', 24.1);
    await ins('2026-09-20', 'oslo_diesel_median', 25); // > 30 days back
    await ins('2026-10-22', 'wdi_nok_l', 7.1);
    await ins('2026-10-21', 'wdi_nok_l', 7.2);
    await ins('2026-10-22', 'usdnok', 10.5); // other series ignored
    await okRun(ago(1), { level: 23.8, nFresh: 70 });
    await t.db.prepare(`INSERT INTO runs (job, started_at, finished_at, ok, detail) VALUES ('prices', ?1, ?1, 0, '{"error":"x"}')`).bind(ago(0.5)).run();

    const r = await marketHandler(url('/api/market'), env(), NOW);
    expect(r).toEqual({
      days: 30,
      osloDieselMedian: [{ day: '2026-10-20', value: 24.1 }, { day: '2026-10-24', value: 23.9 }],
      wdi: [{ day: '2026-10-21', value: 7.2 }, { day: '2026-10-22', value: 7.1 }],
      latest: { level: 23.8, at: ago(1), nFresh: 70 },
    });
    const r1 = await marketHandler(url('/api/market?days=1'), env(), NOW);
    expect(r1.osloDieselMedian).toEqual([{ day: '2026-10-24', value: 23.9 }]);
    expect(r1.wdi).toEqual([]);
    expect((await marketHandler(url('/api/market?days=365'), env(), NOW)).osloDieselMedian).toHaveLength(3);
  });

  it('empty DB → empty series and null latest', async () => {
    const res = await get('/api/market');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.json()).toEqual({ days: 30, osloDieselMedian: [], wdi: [], latest: { level: null, at: null, nFresh: null } });
  });

  it.each(['days=0', 'days=366', 'days=1.5', 'days=abc', 'days=', 'days=-3'])('400 BAD_INPUT for %s', async (q) => {
    const res = await get(`/api/market?${q}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_INPUT');
  });
});

describe('API routing', () => {
  it('unknown /api path → 404 JSON; non-GET → 405; /health still works', async () => {
    const nf = await get('/api/nope');
    expect(nf.status).toBe(404);
    expect(((await nf.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    const post = await worker.fetch(new Request('http://x/api/stations', { method: 'POST' }), env());
    expect(post.status).toBe(405);
    expect((await get('/health')).status).toBe(200);
  });

  it('a DB failure → 500 INTERNAL, not a crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...env(), DB: { prepare: () => { throw new Error('boom'); } } as unknown as D1Database };
    const res = await worker.fetch(new Request('http://x/api/market'), broken);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INTERNAL');
  });
});

describe('GET /api/outlook', () => {
  const now = new Date('2026-10-24T15:00:00.000Z');
  const rise = { at: '2026-10-24T13:00:00.000Z', before: 25, after: 27.5, now: 27.4 };

  it("verdict from the last run's rise, live morning levels for today, stored levels for earlier days", async () => {
    for (let i = 0; i < 5; i++) {
      await station(`ck${i}`, 59.91 + i * 0.001, 10.75, 'Circle K');
      await price(`ck${i}`, 'diesel', 25 + i * 0.1, '2026-10-24T06:00:00.000Z');
    }
    await t.db
      .prepare(`INSERT INTO market_daily (day, series, value) VALUES ('2026-10-23', 'am_all_diesel', 24.5), ('2026-10-23', 'am_circlek_diesel', 24.4), ('2026-10-23', 'am_all_petrol95', 26)`)
      .run();
    await okRun('2026-10-24T14:30:00.000Z', { level: 27.3, levels: { diesel: 27.3, petrol95: 28.9 }, rises: { diesel: rise, petrol95: null } });
    const o = await outlookHandler(url('/api/outlook?fuel=diesel'), env(), now);
    expect(o).toMatchObject({ fuel: 'diesel', verdict: 'wait', rise, level: 27.3 });
    expect(o.history).toEqual([
      { day: '2026-10-23', levels: { all: 24.5, circlek: 24.4 } },
      { day: '2026-10-24', levels: { all: 25.2, circlek: 25.2 } },
    ]);
    expect(o.norm).toMatchObject({ day: '2026-10-24', level: 25.2, nDays: 1, normal: null });
    expect(await outlookHandler(url('/api/outlook?fuel=petrol95'), env(), now)).toMatchObject({ verdict: 'normal', level: 28.9, rise: null });
    await expect(outlookHandler(url('/api/outlook?fuel=petrol98'), env(), now)).rejects.toThrow(/fuel/);
  });

  it("stations use the run's Oslo-wide rise: a pre-rise price is flagged outdated with no saving", async () => {
    await station('k', 59.9287, 10.7499, 'Circle K');
    await price('k', 'diesel', 25.1, '2026-10-24T10:38:00.000Z');
    await okRun('2026-10-24T14:30:00.000Z', { level: 27.3, rises: { diesel: rise } });
    const res = await stationsHandler(url('/api/stations?fuel=diesel&lat=59.9287&lon=10.7499&radius_km=1'), env(), now);
    expect(res.stations[0]).toMatchObject({ id: 'k', outdated: true, netSavingNok: null });
    expect(res.coverage).toEqual({ current: 0, outdated: 1, jumpDetected: true });
  });
});
