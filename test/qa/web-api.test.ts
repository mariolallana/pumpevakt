// QA black-box tests for the web v1 API, called through the Worker's default export fetch handler.
// Spec: docs/web-v1-contract.md (scope 1, response shapes), docs/04 §3 + shared definitions, docs/05 §2.
// Data is seeded straight into QA's own spec-schema D1 (qaDb.ts) with timestamps relative to a frozen NOW.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import worker from '../../src/index';
import { createQaDb, type QaDb } from './qaDb';
import { NOW, OSLO, northOf, hoursBefore } from './helpers';

let db: QaDb;
beforeAll(async () => { db = await createQaDb(); });
afterAll(async () => { await db.dispose(); });
beforeEach(async () => {
  await db.reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); });

const ASSET_HTML = '<!doctype html><title>QA asset</title>';
const assetsCalls: string[] = [];
const ASSETS = {
  fetch: async (req: Request | string) => {
    assetsCalls.push(typeof req === 'string' ? req : req.url);
    return new Response(ASSET_HTML, { headers: { 'content-type': 'text/html' } });
  },
};
const env = () => ({ ...db.env, ASSETS });

async function call(path: string, init?: RequestInit) {
  const res = await (worker as any).fetch(new Request(`https://qa.local${path}`, init), env(), {
    waitUntil() {}, passThroughOnException() {},
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { res, body, text };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const minsBefore = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

async function station(id: string, at: { lat: number; lon: number }, extra: { name?: string; brand?: string; address?: string } = {}) {
  await db.DB.prepare('INSERT INTO stations (id, name, brand, address, lat, lon, active) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)')
    .bind(id, extra.name ?? `Station ${id}`, extra.brand ?? 'QA', extra.address ?? 'Testveien 1, 0150 Oslo', at.lat, at.lon).run();
}
async function price(stationId: string, fuel: string, p: number, observedAt: string) {
  await db.DB.prepare("INSERT INTO prices (station_id, fuel, price, observed_at, source) VALUES (?1, ?2, ?3, ?4, 'drivstoffapp')")
    .bind(stationId, fuel, p, observedAt).run();
}
async function run(startedAt: string, ok: number | null, detail: Record<string, unknown>, job = 'prices') {
  const finished = ok === null ? null : new Date(Date.parse(startedAt) + 5000).toISOString();
  await db.DB.prepare('INSERT INTO runs (job, started_at, finished_at, ok, detail) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(job, startedAt, finished, ok, JSON.stringify(detail)).run();
}
async function market(day: string, series: string, value: number) {
  await db.DB.prepare('INSERT INTO market_daily (day, series, value) VALUES (?1, ?2, ?3)').bind(day, series, value).run();
}

/**
 * Main fixture around Oslo S (origin), diesel unless stated. Distances are due north, so distanceKm ≈ km.
 *   A  1 km  23.00  30 min      B  2 km  22.50  2 h       C  3 km  24.00  7 h (stale)
 *   D  4 km  21.00  25 h (excluded)   E 15 km 20.00 fresh (outside 10 km, inside 20 km)
 *   F  0.5 km petrol95 only      G  5 km  22.00 @3 h then 23.50 @1 h (latest = 23.50)
 * Petrol95: A 25.00 fresh, F 26.00 fresh, B 27.00 @8 h (stale), E 24.00 fresh @15 km.
 * Petrol98: A 28.00 @8 h, B 27.50 @10 h (nothing fresh → refPrice null).
 */
async function seedMain(opts: { runs?: boolean } = {}) {
  await station('A', northOf(1), { name: 'Alpha', brand: 'Uno-X', address: 'Aveien 1' });
  await station('B', northOf(2), { name: 'Bravo', brand: 'Circle K' });
  await station('C', northOf(3));
  await station('D', northOf(4));
  await station('E', northOf(15));
  await station('F', northOf(0.5));
  await station('G', northOf(5));
  await price('A', 'diesel', 23.0, minsBefore(30));
  await price('B', 'diesel', 22.5, hoursBefore(NOW, 2));
  await price('C', 'diesel', 24.0, hoursBefore(NOW, 7));
  await price('D', 'diesel', 21.0, hoursBefore(NOW, 25));
  await price('E', 'diesel', 20.0, minsBefore(10));
  await price('G', 'diesel', 22.0, hoursBefore(NOW, 3));
  await price('G', 'diesel', 23.5, hoursBefore(NOW, 1));
  await price('A', 'petrol95', 25.0, minsBefore(30));
  await price('F', 'petrol95', 26.0, minsBefore(20));
  await price('B', 'petrol95', 27.0, hoursBefore(NOW, 8));
  await price('E', 'petrol95', 24.0, minsBefore(20));
  await price('A', 'petrol98', 28.0, hoursBefore(NOW, 8));
  await price('B', 'petrol98', 27.5, hoursBefore(NOW, 10));
  if (opts.runs !== false) {
    await run(hoursBefore(NOW, 1.5), 1, { nObs: 300, nFresh: 41, level: 25.0, dayMedian: 25.0 });
    await run(minsBefore(30), 1, { nObs: 300, nFresh: 40, level: 24.0, dayMedian: 24.5 });
    await run(minsBefore(15), 0, { error: 'boom' });
    await run(NOW.toISOString(), null, {});
  }
  // A daily median that differs from the latest L, to tell the two apart.
  await market('2026-10-24', 'oslo_diesel_median', 24.4);
}

const qs = (o: Record<string, string | number>) => '?' + new URLSearchParams(Object.entries(o).map(([k, v]): [string, string] => [k, String(v)])).toString();
const stations = (o: Record<string, string | number> = {}) => call('/api/stations' + qs({ lat: OSLO.lat, lon: OSLO.lon, ...o }));

describe('QA-API-S GET /api/stations: shape, filters, sort (contract §Response shapes)', () => {
  it('QA-API-S-01 200 JSON with every contract field and the right types', async () => {
    await seedMain();
    const { res, body } = await stations();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);
    expect(body).toMatchObject({ fuel: 'diesel', radiusKm: 10 });
    expect(body.origin.lat).toBeCloseTo(OSLO.lat, 6);
    expect(body.origin.lon).toBeCloseTo(OSLO.lon, 6);
    expect(body.generatedAt).toMatch(ISO);
    expect(Math.abs(Date.parse(body.generatedAt) - NOW.getTime())).toBeLessThan(60_000);
    expect(Array.isArray(body.stations)).toBe(true);
    const a = body.stations.find((s: any) => s.id === 'A');
    expect(a).toMatchObject({ id: 'A', name: 'Alpha', brand: 'Uno-X', address: 'Aveien 1', price: 23, stale: false });
    expect(a.lat).toBeCloseTo(northOf(1).lat, 6);
    expect(a.lon).toBeCloseTo(OSLO.lon, 6);
    expect(a.observedAt).toMatch(ISO);
    expect(Date.parse(a.observedAt)).toBe(Date.parse(minsBefore(30)));
    for (const k of ['id', 'name', 'brand', 'address', 'lat', 'lon', 'price', 'observedAt', 'ageMinutes', 'stale', 'distanceKm', 'netSavingNok'])
      expect(Object.keys(a)).toContain(k);
  });

  it('QA-API-S-02 Cache-Control: public, max-age=60', async () => {
    await seedMain();
    const { res } = await stations();
    expect(res.headers.get('cache-control')?.replace(/\s/g, '')).toBe('public,max-age=60');
  });

  it('QA-API-S-03 defaults: radius 10, fuel diesel', async () => {
    await seedMain();
    const { body } = await stations();
    expect(body.radiusKm).toBe(10);
    expect(body.fuel).toBe('diesel');
    const ids = body.stations.map((s: any) => s.id);
    expect(ids).not.toContain('E'); // 15 km
    expect(ids).not.toContain('F'); // no diesel
  });

  it('QA-API-S-04 only prices ≤ 24 h old; 7 h-old price included and flagged stale', async () => {
    await seedMain();
    const { body } = await stations();
    const ids = body.stations.map((s: any) => s.id).sort();
    expect(ids).toEqual(['A', 'B', 'C', 'G']);
    const byId = Object.fromEntries(body.stations.map((s: any) => [s.id, s]));
    expect(byId.C.stale).toBe(true);
    expect(byId.A.stale).toBe(false);
    expect(byId.B.stale).toBe(false);
    expect(byId.G.stale).toBe(false);
  });

  it('QA-API-S-05 boundaries: exactly 6 h → not stale, 6 h + 1 min → stale, exactly 24 h → included, 24 h + 1 min → excluded', async () => {
    await station('S6', northOf(1));
    await station('S6b', northOf(1.5));
    await station('S24', northOf(2));
    await station('S24b', northOf(2.5));
    await price('S6', 'diesel', 23, hoursBefore(NOW, 6));
    await price('S6b', 'diesel', 23, minsBefore(361));
    await price('S24', 'diesel', 23, hoursBefore(NOW, 24));
    await price('S24b', 'diesel', 23, minsBefore(24 * 60 + 1));
    const { body } = await stations();
    const byId = Object.fromEntries(body.stations.map((s: any) => [s.id, s]));
    expect(byId.S6?.stale).toBe(false);
    expect(byId.S6b?.stale).toBe(true);
    expect(byId.S24).toBeDefined();
    expect(byId.S24b).toBeUndefined();
  });

  it('QA-API-S-06 uses the latest price per station (newest observed_at), not an older cheaper one', async () => {
    await seedMain();
    const { body } = await stations();
    const g = body.stations.find((s: any) => s.id === 'G');
    expect(g.price).toBe(23.5);
    expect(g.ageMinutes).toBeCloseTo(60, 0);
    expect(body.stations.filter((s: any) => s.id === 'G')).toHaveLength(1);
  });

  it('QA-API-S-07 a station whose newest price is > 24 h old is excluded even if it also had an older row', async () => {
    await station('X', northOf(1));
    await price('X', 'diesel', 22, hoursBefore(NOW, 30));
    await price('X', 'diesel', 23, hoursBefore(NOW, 26));
    const { body } = await stations();
    expect(body.stations).toEqual([]);
  });

  it('QA-API-S-08 ageMinutes = minutes since observedAt (integer-ish), distanceKm has ≤ 2 decimals and is haversine', async () => {
    await seedMain();
    const { body } = await stations();
    const exp: Record<string, [number, number]> = { A: [30, 1], B: [120, 2], C: [420, 3], G: [60, 5] };
    for (const s of body.stations) {
      const [age, km] = exp[s.id]!;
      expect(Math.abs(s.ageMinutes - age)).toBeLessThanOrEqual(1);
      expect(Number(s.distanceKm.toFixed(2))).toBe(s.distanceKm);
      expect(s.distanceKm).toBeCloseTo(km, 2);
    }
  });

  it('QA-API-S-09 diesel refPrice = latest Oslo level L from the newest ok prices run (not the daily median, not an older run)', async () => {
    await seedMain();
    const { body } = await stations();
    expect(body.refPrice).toBe(24.0);
  });

  it('QA-API-S-10 netSavingNok per docs/04 §3 (hand-computed, L 24.00, tank 50, 6.5 L/100), integer', async () => {
    await seedMain();
    const { body } = await stations();
    const byId = Object.fromEntries(body.stations.map((s: any) => [s.id, s.netSavingNok]));
    // A: 50 − 2.6×0.065×23 = 46.11 · B: 75 − 5.2×0.065×22.5 = 67.40 · G: 25 − 13×0.065×23.5 = 5.14 · C: 0 − 7.8×0.065×24 = −12.17
    expect(byId).toEqual({ A: 46, B: 67, G: 5, C: -12 });
    for (const v of Object.values(byId)) expect(Number.isInteger(v)).toBe(true);
  });

  it('QA-API-S-11 sorted by netSavingNok desc', async () => {
    await seedMain();
    const { body } = await stations();
    expect(body.stations.map((s: any) => s.id)).toEqual(['B', 'A', 'G', 'C']);
  });

  it('QA-API-S-12 radius_km=20 includes the 15 km station, which ranks first (149 kr)', async () => {
    await seedMain();
    const { body } = await stations({ radius_km: 20 });
    expect(body.radiusKm).toBe(20);
    expect(body.stations[0].id).toBe('E');
    // 4 × 50 = 200 − 39 × 0.065 × 20 = 50.7 → 149.3
    expect(body.stations[0].netSavingNok).toBe(149);
  });

  it('QA-API-S-13 radius_km=5 keeps only stations within 5 km', async () => {
    await seedMain();
    const { body } = await stations({ radius_km: 5 });
    for (const s of body.stations) expect(s.distanceKm).toBeLessThanOrEqual(5);
    expect(body.stations.map((s: any) => s.id)).not.toContain('E');
  });

  it('QA-API-S-14 diesel with no prices run → refPrice falls back to the median of fresh (≤ 6 h) prices in the radius', async () => {
    await seedMain({ runs: false });
    const { body } = await stations();
    // fresh diesel in 10 km, latest per station: A 23.00, B 22.50, G 23.50 (C is 7 h; G's 22.00 is superseded) → 23.00
    expect(body.refPrice).toBe(23.0);
    expect(body.stations.find((s: any) => s.id === 'B').netSavingNok).toBe(Math.round((23 - 22.5) * 50 - 5.2 * 0.065 * 22.5));
  });

  it('QA-API-S-15 petrol95: refPrice = median of fresh petrol95 in the radius; stale and out-of-radius prices excluded from it', async () => {
    await seedMain();
    const { body } = await stations({ fuel: 'petrol95' });
    expect(body.fuel).toBe('petrol95');
    expect(body.refPrice).toBe(25.5); // A 25, F 26 (B is 8 h old, E is 15 km)
    expect(body.stations.map((s: any) => s.id)).toEqual(['A', 'F', 'B']);
    const ns = Object.fromEntries(body.stations.map((s: any) => [s.id, s.netSavingNok]));
    // A: 25 − 2.6×0.065×25 = 20.78 · F: −25 − 1.3×0.065×26 = −27.20 · B: −75 − 5.2×0.065×27 = −84.13
    expect(ns).toEqual({ A: 21, F: -27, B: -84 });
  });

  it('QA-API-S-16 no fresh prices for the fuel → refPrice null, every netSavingNok null, sorted by price asc', async () => {
    await seedMain();
    const { body } = await stations({ fuel: 'petrol98' });
    expect(body.refPrice).toBeNull();
    expect(body.stations.map((s: any) => s.id)).toEqual(['B', 'A']); // 27.50, 28.00
    for (const s of body.stations) expect(s.netSavingNok).toBeNull();
  });

  it('QA-API-S-17 equal netSavingNok → cheaper price first (tie-break on the rounded integer)', async () => {
    await run(minsBefore(10), 1, { nFresh: 40, level: 24.0 });
    await station('P1', northOf(1));
    await station('P2', { lat: OSLO.lat, lon: OSLO.lon + 1 / (111.195 * Math.cos((OSLO.lat * Math.PI) / 180)) });
    // P1: 1 km N, 23.00 → 46. P2: ~1 km E, 23.00 → 46.
    await price('P1', 'diesel', 23.0, minsBefore(10));
    await price('P2', 'diesel', 23.0, minsBefore(10));
    // P3: 3 km, 22.40 → 80 − 7.8×0.065×22.4 = 68.64 → 69 ; P4: 1 km S, 22.55 → 72.5 − 3.81 = 68.69 → 69.
    // Contract: sort by netSavingNok (the rounded integer) desc, then price asc → P3 (22.40) before P4 (22.55).
    // (Sorting on the unrounded value would put P4 first: QA-SPEC-W6.)
    await station('P3', northOf(3));
    await station('P4', { lat: OSLO.lat - 1 / 111.195, lon: OSLO.lon });
    await price('P3', 'diesel', 22.4, minsBefore(10));
    await price('P4', 'diesel', 22.55, minsBefore(10));
    const { body } = await stations();
    const ns = Object.fromEntries(body.stations.map((s: any) => [s.id, s.netSavingNok]));
    expect(ns.P3).toBe(69);
    expect(ns.P4).toBe(69);
    expect(body.stations.slice(0, 2).map((s: any) => s.id)).toEqual(['P3', 'P4']);
  });

  it('QA-API-S-22 fresh (≤ 6 h) rows always rank before stale rows, even when a stale row saves more (coordinator decision, IMPL-W12)', async () => {
    await seedMain();
    // Very cheap but 7 h old, right next door: best net saving of all, yet must come after every fresh row.
    await station('Z', northOf(0.2));
    await price('Z', 'diesel', 20.0, hoursBefore(NOW, 7));
    // Exactly 6 h old counts as fresh and is ranked with the fresh group.
    await station('S6', northOf(0.3));
    await price('S6', 'diesel', 23.9, hoursBefore(NOW, 6));
    const { body } = await stations();
    const ids = body.stations.map((s: any) => s.id);
    const firstStale = body.stations.findIndex((s: any) => s.stale);
    expect(body.stations.slice(firstStale).every((s: any) => s.stale)).toBe(true);
    expect(ids.slice(0, firstStale)).toEqual(['B', 'A', 'G', 'S6']); // fresh: 67, 46, 5, then S6 (L 24, 23.9 at 0.3 km → 5 − 0.73 = 4)
    expect(ids.slice(firstStale)).toEqual(['Z', 'C']); // stale group sorted by saving: Z (≈ 199) before C (−12)
    const z = body.stations.find((s: any) => s.id === 'Z');
    expect(z.netSavingNok).toBeGreaterThan(body.stations[0].netSavingNok);
  });

  it('QA-API-S-23 fresh-before-stale also holds when every netSavingNok is null (sort by price inside each group)', async () => {
    await station('F1', northOf(1));
    await station('F2', northOf(2));
    await station('S1', northOf(3));
    await price('F1', 'petrol98', 29.0, hoursBefore(NOW, 8)); // stale only → refPrice null
    await price('F2', 'petrol98', 28.0, hoursBefore(NOW, 10));
    await price('S1', 'petrol98', 27.0, hoursBefore(NOW, 12));
    const { body } = await stations({ fuel: 'petrol98' });
    expect(body.refPrice).toBeNull();
    expect(body.stations.map((s: any) => s.id)).toEqual(['S1', 'F2', 'F1']);
  });

  it('QA-API-S-18 fuel with no data at all → 200 with empty list (not an error)', async () => {
    await seedMain();
    const { res, body } = await stations({ fuel: 'hvo100' });
    expect(res.status).toBe(200);
    expect(body.stations).toEqual([]);
    expect(body.refPrice).toBeNull();
  });

  it('QA-API-S-19 empty database → 200, empty list, refPrice null', async () => {
    const { res, body } = await stations();
    expect(res.status).toBe(200);
    expect(body.stations).toEqual([]);
    expect(body.refPrice).toBeNull();
  });

  it('QA-API-S-20 latest Oslo level of the newest ok run is null (nFresh < 30) → falls back to the radius median (contract "if missing")', async () => {
    await seedMain({ runs: false });
    await run(hoursBefore(NOW, 1), 1, { nFresh: 41, level: 25.0 });
    await run(minsBefore(30), 1, { nFresh: 0, level: null });
    const { body } = await stations();
    // Literal reading: the latest level is missing → median of fresh in radius = 23.00.
    // Tolerated alternative (spec ambiguity QA-SPEC-W4): the newest non-null level 25.00.
    expect([23.0, 25.0]).toContain(body.refPrice);
    console.log(`[QA-API-S-20] refPrice when the newest run has level=null: ${body.refPrice}`);
  });

  it('QA-API-S-21 every station row is within the radius, has a price for the fuel and never a tax-free (fd) price', async () => {
    await seedMain();
    const { body, text } = await stations({ radius_km: 30 });
    expect(text).not.toMatch(/fd_price|"fd"|tax.?free/i);
    for (const s of body.stations) {
      expect(s.distanceKm).toBeLessThanOrEqual(30);
      expect(typeof s.price).toBe('number');
    }
  });
});

describe('QA-API-V /api/stations param validation (contract: 400 {"error":{"code":"BAD_INPUT"}})', () => {
  const bad: Array<[string, Record<string, string | number>]> = [
    ['lat not a number', { lat: 'abc' }],
    ['lat out of range', { lat: 91 }],
    ['lon out of range', { lon: 181 }],
    ['lon not a number', { lon: '' }],
    ['radius_km not a number', { radius_km: 'ten' }],
    ['radius_km zero', { radius_km: 0 }],
    ['radius_km negative', { radius_km: -5 }],
    ['fuel unknown', { fuel: 'kerosene' }],
    ['fuel fd (tax-free diesel)', { fuel: 'fd' }],
    ['fuel source field name', { fuel: 'gasoline' }],
    ['lat Infinity', { lat: 'Infinity' }],
  ];
  for (const [i, [label, params]] of bad.entries()) {
    it(`QA-API-V-${String(i + 1).padStart(2, '0')} ${label} → 400 BAD_INPUT`, async () => {
      const { res, body } = await stations(params);
      expect(res.status).toBe(400);
      expect(body?.error?.code).toBe('BAD_INPUT');
      expect(typeof body?.error?.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);
    });
  }

  it('QA-API-V-20 radius_km > 30 is never served wider than 30 (400 or clamped to 30)', async () => {
    await seedMain();
    const { res, body } = await stations({ radius_km: 31 });
    if (res.status === 400) expect(body.error.code).toBe('BAD_INPUT');
    else {
      expect(res.status).toBe(200);
      expect(body.radiusKm).toBeLessThanOrEqual(30);
    }
    console.log(`[QA-API-V-20] radius_km=31 → ${res.status}${res.status === 200 ? ` radiusKm=${body.radiusKm}` : ''}`);
  });

  it('QA-API-V-21 radius_km = 30 (the max) is accepted', async () => {
    const { res, body } = await stations({ radius_km: 30 });
    expect(res.status).toBe(200);
    expect(body.radiusKm).toBe(30);
  });

  it('QA-API-V-22 missing lat/lon → 200 with origin = Oslo S, never HOME (coordinator decision, IMPL-W11)', async () => {
    await seedMain();
    const { res, body, text } = await call('/api/stations');
    expect(res.status).toBe(200);
    expect(body.origin).toEqual({ lat: 59.9111, lon: 10.7528 });
    expect(body.origin).not.toEqual({ lat: 59.93, lon: 10.8 });
    expect(text).not.toMatch(/59\.93[,}]|"lat":59\.93\b/);
    // distances are measured from Oslo S: A is 1 km north of it
    expect(body.stations.find((s: any) => s.id === 'A').distanceKm).toBeCloseTo(1, 2);
  });

  it('QA-API-V-23 only lat given (no lon) → 400', async () => {
    const { res, body } = await call('/api/stations?lat=59.91');
    expect(res.status).toBe(400);
    expect(body?.error?.code).toBe('BAD_INPUT');
  });

  it('QA-API-V-24 400 responses are JSON', async () => {
    const { res } = await stations({ fuel: 'nope' });
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);
  });

  it('QA-API-V-25 all valid fuels accepted', async () => {
    for (const f of ['diesel', 'petrol95', 'petrol98', 'hvo100']) {
      const { res, body } = await stations({ fuel: f });
      expect(res.status).toBe(200);
      expect(body.fuel).toBe(f);
    }
  });

  it('QA-API-V-26 decimal radius accepted (e.g. 7.5)', async () => {
    const { res } = await stations({ radius_km: 7.5 });
    expect([200, 400]).toContain(res.status);
    console.log(`[QA-API-V-26] radius_km=7.5 → ${res.status}`);
  });
});

async function seedMarket() {
  // 85 days of oslo_diesel_median (2026-08-01 … 2026-10-24) inserted in shuffled order, WDI on weekdays only,
  // plus series that must not leak (ulsd_usd_gal, usdnok).
  const days: string[] = [];
  for (let d = new Date('2026-08-01T00:00:00Z'); d <= new Date('2026-10-24T00:00:00Z'); d = new Date(d.getTime() + 86_400_000))
    days.push(d.toISOString().slice(0, 10));
  const shuffled = [...days].sort((a, b) => (a.charCodeAt(9) % 3) - (b.charCodeAt(9) % 3) || b.localeCompare(a));
  for (const [i, day] of shuffled.entries()) {
    const idx = days.indexOf(day);
    await market(day, 'oslo_diesel_median', +(24 + idx * 0.01).toFixed(2));
    const wd = new Date(day + 'T00:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) await market(day, 'wdi_nok_l', +(7 + idx * 0.001).toFixed(3));
    if (i % 2 === 0) await market(day, 'ulsd_usd_gal', 2.5);
    await market(day, 'usdnok', 10.5);
  }
  return days;
}

describe('QA-API-M GET /api/market (contract §Response shapes)', () => {
  it('QA-API-M-01 200 JSON, contract fields, Cache-Control public max-age=60', async () => {
    await seedMarket();
    await run(minsBefore(30), 1, { nFresh: 40, level: 24.0 });
    const { res, body } = await call('/api/market');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);
    expect(res.headers.get('cache-control')?.replace(/\s/g, '')).toBe('public,max-age=60');
    expect(Object.keys(body).sort()).toEqual(['days', 'latest', 'osloDieselMedian', 'wdi']);
    expect(body.days).toBe(30);
  });

  it('QA-API-M-02 default days=30: series ascending, only last ~30 days, today included', async () => {
    const days = await seedMarket();
    const { body } = await call('/api/market');
    const s: Array<{ day: string; value: number }> = body.osloDieselMedian;
    const ds = s.map((p) => p.day);
    expect(ds).toEqual([...ds].sort());
    expect(new Set(ds).size).toBe(ds.length);
    expect(ds.at(-1)).toBe('2026-10-24');
    expect(ds).toContain('2026-09-25'); // 29 days before today
    for (const d of ds) expect(d >= '2026-09-24').toBe(true); // 30 days back at the most (off-by-one: QA-SPEC-W5)
    expect([30, 31]).toContain(ds.length);
    console.log(`[QA-API-M-02] days=30 → ${ds.length} points, first ${ds[0]}`);
    // values come from the table unchanged
    const p = s.find((x) => x.day === '2026-10-24')!;
    expect(p.value).toBeCloseTo(24 + days.indexOf('2026-10-24') * 0.01, 6);
  });

  it('QA-API-M-03 wdi series: ascending, wdi_nok_l only, same window', async () => {
    await seedMarket();
    const { body } = await call('/api/market');
    const ds = body.wdi.map((p: any) => p.day);
    expect(ds).toEqual([...ds].sort());
    expect(ds.length).toBeGreaterThanOrEqual(20);
    expect(ds.length).toBeLessThanOrEqual(23);
    for (const d of ds) {
      expect(d >= '2026-09-24').toBe(true);
      const wd = new Date(d + 'T00:00:00Z').getUTCDay();
      expect(wd).not.toBe(0);
      expect(wd).not.toBe(6);
    }
    for (const p of body.wdi) expect(p.value).toBeLessThan(10); // not usdnok (10.5) / not median (24+)
  });

  it('QA-API-M-04 days=7 / days=365 / days=1', async () => {
    await seedMarket();
    const r7 = (await call('/api/market?days=7')).body;
    expect(r7.days).toBe(7);
    expect([7, 8]).toContain(r7.osloDieselMedian.length);
    expect(r7.osloDieselMedian[0].day >= '2026-10-17').toBe(true);
    const r365 = (await call('/api/market?days=365')).body;
    expect(r365.days).toBe(365);
    expect(r365.osloDieselMedian).toHaveLength(85);
    const r1 = await call('/api/market?days=1');
    expect(r1.res.status).toBe(200);
    expect(r1.body.osloDieselMedian.at(-1).day).toBe('2026-10-24');
    expect(r1.body.osloDieselMedian.length).toBeLessThanOrEqual(2);
  });

  const badDays = ['0', '-1', 'abc', '', 'NaN'];
  for (const [i, d] of badDays.entries()) {
    it(`QA-API-M-1${i} days=${JSON.stringify(d)} → 400 BAD_INPUT`, async () => {
      const { res, body } = await call(`/api/market?days=${encodeURIComponent(d)}`);
      expect(res.status).toBe(400);
      expect(body?.error?.code).toBe('BAD_INPUT');
    });
  }

  it('QA-API-M-20 days=366 is never served wider than 365 (400 or clamp)', async () => {
    await seedMarket();
    const { res, body } = await call('/api/market?days=366');
    if (res.status === 400) expect(body.error.code).toBe('BAD_INPUT');
    else expect(body.days).toBeLessThanOrEqual(365);
    console.log(`[QA-API-M-20] days=366 → ${res.status}`);
  });

  it('QA-API-M-21 latest = the newest *ok* prices run (later failed / unfinished runs ignored)', async () => {
    await run(hoursBefore(NOW, 2), 1, { nFresh: 41, level: 25.0 });
    await run(minsBefore(30), 1, { nFresh: 40, level: 24.0, dayMedian: 24.5 });
    await run(minsBefore(15), 0, { error: 'boom' });
    await run(NOW.toISOString(), null, {});
    await run(minsBefore(5), 1, { nPoints: 3, lastWdi: 7.1 }, 'market');
    const { body } = await call('/api/market');
    expect(body.latest.level).toBe(24.0);
    expect(body.latest.nFresh).toBe(40);
    expect(body.latest.at).toMatch(ISO);
    const at = Date.parse(body.latest.at);
    expect(at >= Date.parse(minsBefore(30)) && at <= Date.parse(minsBefore(30)) + 5000).toBe(true);
  });

  it('QA-API-M-22 no runs, no market data → 200 with empty series and null latest fields', async () => {
    const { res, body } = await call('/api/market');
    expect(res.status).toBe(200);
    expect(body.osloDieselMedian).toEqual([]);
    expect(body.wdi).toEqual([]);
    expect(body.latest).toEqual({ level: null, at: null, nFresh: null });
  });

  it('QA-API-M-23 newest ok run had level null (coverage guard) → latest.level null, never a stale older level', async () => {
    await run(hoursBefore(NOW, 2), 1, { nFresh: 41, level: 25.0 });
    await run(minsBefore(30), 1, { nFresh: 0, level: null });
    const { body } = await call('/api/market');
    expect(body.latest.level).toBeNull();
    expect(body.latest.at).not.toBeNull();
  });
});

describe('QA-API-R routing with static assets enabled (contract scope 2)', () => {
  it('QA-API-R-01 GET /health is still served by the Worker as JSON', async () => {
    await run(minsBefore(30), 1, { nFresh: 40, level: 24.0 });
    const { res, body } = await call('/health');
    expect(res.status).toBe(200);
    expect(body.jobs.prices.nFresh).toBe(40);
    expect(body.jobs.prices).toHaveProperty('consecutiveFailures');
    expect(body.jobs.prices).toHaveProperty('lastOk');
  });

  it('QA-API-R-02 unknown /api/* route is not answered with HTML or 200', async () => {
    const { res, text } = await call('/api/nope');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toBe(ASSET_HTML);
  });

  it('QA-API-R-03 POST /api/stations is not a 200 (read-only API)', async () => {
    const { res } = await call('/api/stations?lat=59.9&lon=10.7', { method: 'POST' });
    expect(res.status).not.toBe(200);
  });

  it('QA-API-R-05 HOME never appears in any API response, whatever HOME is configured to (docs/05 §2, IMPL-W11)', async () => {
    await seedMain();
    await run(minsBefore(5), 1, { nPoints: 3, lastWdi: 7.1 }, 'market');
    const homeEnv = { ...db.env, ASSETS, HOME_LAT: '59.987654', HOME_LON: '10.876543' };
    const ctx = { waitUntil() {}, passThroughOnException() {} };
    const paths = ['/api/stations', '/api/stations?radius_km=30', '/api/stations?fuel=petrol95', '/api/market', '/api/market?days=365', '/api/stations?lat=1', '/api/nope'];
    for (const p of paths) {
      const res = await (worker as any).fetch(new Request('https://qa.local' + p), homeEnv, ctx);
      const t = await res.text();
      expect(t, p).not.toMatch(/59\.98765|10\.87654/);
    }
  });

  it('QA-API-R-04 /api/* never returns personal data or config (no chat ids, no tank size)', async () => {
    await seedMain();
    const s = await stations();
    const m = await call('/api/market');
    for (const t of [s.text, m.text]) {
      expect(t).not.toContain('123456789');
      expect(t).not.toMatch(/ALLOWED_CHAT|TELEGRAM|TANK_L|CONSUMPTION/);
    }
  });
});

describe('QA-API-E2E prices job → /api (real job, recorded + synthetic fixtures, no network)', () => {
  it('QA-API-E2E-01 after a prices run, /api/stations uses that run\'s L as diesel refPrice and lists only real diesel prices', async () => {
    const { runPricesJob } = await import('../../src/jobs/prices');
    const { CENTRES } = await import('../../src/sources/drivstoffapp');
    const { fakeFetch, sourcesRouter, syntheticFreshStations, fixtures } = await import('./helpers');
    const byCentre = [[...syntheticFreshStations(40, NOW), ...(fixtures.realStations as unknown[])], fixtures.adversarialStations, []];
    const { fn } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: byCentre }));
    const r = await runPricesJob(db.env, { fetchFn: fn, now: NOW });
    expect(r.error).toBeUndefined();
    expect(r.level).not.toBeNull();
    const { body, text } = await stations({ radius_km: 30 });
    expect(body.refPrice).toBe(r.level!.median);
    expect(body.stations.length).toBeGreaterThanOrEqual(40);
    expect(text).not.toMatch(/fd_price/);
    for (const s of body.stations) {
      expect(s.price).toBeGreaterThanOrEqual(5);
      expect(s.ageMinutes).toBeLessThanOrEqual(24 * 60);
      if (!s.outdated) expect(s.netSavingNok).not.toBeNull(); // outdated rows claim no saving (F22)
    }
    const m = (await call('/api/market')).body;
    expect(m.latest.level).toBe(r.level!.median);
    expect(m.latest.nFresh).toBe(r.level!.nFresh);
    expect(m.osloDieselMedian.at(-1)).toEqual({ day: '2026-10-24', value: r.level!.median });
  });
});

describe('QA-API-OBS recorded behaviour where the contract is silent', () => {
  it('QA-API-OBS-01 diesel L from an ok run 2 days old (prices job failing since) is still used as refPrice', async () => {
    await run(hoursBefore(NOW, 48), 1, { nFresh: 40, level: 26.0 });
    for (let h = 47; h >= 1; h--) await run(hoursBefore(NOW, h), 0, { error: 'down' });
    await station('A', northOf(1));
    await price('A', 'diesel', 23.0, hoursBefore(NOW, 20));
    const { body } = await stations();
    console.log(`[QA-API-OBS-01] refPrice with a 48 h-old L: ${body.refPrice} (saving A = ${body.stations[0]?.netSavingNok})`);
    expect([26.0, null]).toContain(body.refPrice);
  });

  it('QA-API-OBS-02 a single fresh station in the radius becomes its own reference (saving ≈ −detour)', async () => {
    await station('A', northOf(3));
    await price('A', 'petrol95', 25.0, minsBefore(10));
    const { body } = await stations({ fuel: 'petrol95' });
    console.log(`[QA-API-OBS-02] refPrice=${body.refPrice}, saving=${body.stations[0]?.netSavingNok}`);
    expect(body.refPrice).toBe(25.0);
  });

  it('QA-API-OBS-03 a price observed in the future (clock skew) is shown with ageMinutes 0, not negative', async () => {
    await station('A', northOf(1));
    await price('A', 'diesel', 23.0, new Date(NOW.getTime() + 15 * 60_000).toISOString());
    const { body } = await stations();
    expect(body.stations[0].ageMinutes).toBeGreaterThanOrEqual(0);
  });

  it('QA-API-OBS-04 HEAD /api/stations answers like GET', async () => {
    const { res } = await call('/api/stations?lat=59.91&lon=10.75', { method: 'HEAD' });
    expect(res.status).toBe(200);
  });
});
