import { describe, expect, it } from 'vitest';
import nearby from './fixtures/drivstoffapp-nearby.json';
import fredCsv from './fixtures/fred-ddfuelnyh.csv?raw';
import nbCsv from './fixtures/norgesbank-usdnok.csv?raw';
import { CENTRES, dedupeObs, fetchDrivstoffapp, mapStations, toIsoUtc } from '../../src/sources/drivstoffapp';
import { fetchFred, parseFredCsv } from '../../src/sources/fred';
import { fetchUsdNok, parseNorgesBankCsv } from '../../src/sources/norgesBank';
import { haversineKm, OSLO_S } from '../../src/core/geo';
import { USER_AGENT } from '../../src/types';
import { fakeFetch, obs, rawStation } from './helpers';

describe('drivstoffapp mapStations (recorded fixture, docs/01 section 2)', () => {
  const out = mapStations(nearby);

  it('maps every non-null price with an updated_at, excluding fd_price', () => {
    // fixture: 13 diesel + 15 gasoline + 9 octane + 8 hvo100 non-null prices (4 fd_price ignored)
    expect(out).toHaveLength(45);
    expect(out.filter((o) => o.fuel === 'diesel')).toHaveLength(13);
    expect(out.filter((o) => o.fuel === 'petrol95')).toHaveLength(15);
    expect(out.filter((o) => o.fuel === 'petrol98')).toHaveLength(9);
    expect(out.filter((o) => o.fuel === 'hvo100')).toHaveLength(8);
  });

  it('maps fields and per-fuel updated_at to ISO UTC', () => {
    const d = out.find((o) => o.station.id === 'j1i4da8bf8wkcql' && o.fuel === 'diesel')!;
    expect(d).toEqual({
      station: { id: 'j1i4da8bf8wkcql', name: 'Fredensborg', brand: 'Uno X', address: 'Maridalsveien 10, 0178 Oslo', lat: 59.92082191643188, lon: 10.75106396077194 },
      fuel: 'diesel',
      price: 24.77,
      observedAt: '2026-10-24T07:26:46.000Z',
    });
    const p98 = out.find((o) => o.station.id === 'j1i4da8bf8wkcql' && o.fuel === 'petrol98')!;
    expect(p98.observedAt).toBe('2026-10-12T05:34:30.059Z');
  });

  it('null brand falls back to the chain name or empty string; all observedAt end in Z', () => {
    for (const o of out) {
      expect(typeof o.station.brand).toBe('string');
      expect(o.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('ignores fd_price, nulls, out-of-range prices, missing updated_at, missing coordinates', () => {
    const ts = '2026-10-24 08:00:00.000Z';
    const s = rawStation('x', 59.91, 10.75, { diesel_price: 4.99, gasoline_price: 60.01, octane_price: 5, hvo100_price: 60, fd_price: 20 }, ts);
    const noUpd = rawStation('y', 59.91, 10.75, { diesel_price: 24 }, ts);
    (noUpd.prices.updated_at as Record<string, string>) = {};
    const noLoc = { ...rawStation('z', 0, 0, { diesel_price: 24 }, ts), location: { latitude: null, longitude: null } };
    const r = mapStations([s, noUpd, noLoc, null, 42]);
    expect(r.map((o) => `${o.fuel}:${o.price}`).sort()).toEqual(['hvo100:60', 'petrol98:5']);
  });

  it('non-array body throws (format change)', () => {
    expect(() => mapStations({ items: [] })).toThrow();
    expect(() => mapStations(null)).toThrow();
  });

  it('toIsoUtc', () => {
    expect(toIsoUtc('2026-10-24 07:26:46.000Z')).toBe('2026-10-24T07:26:46.000Z');
    expect(toIsoUtc('2026-10-24T07:26:46Z')).toBe('2026-10-24T07:26:46.000Z');
    expect(toIsoUtc('2026-10-24 07:26:46')).toBe('2026-10-24T07:26:46.000Z');
    expect(toIsoUtc('2026-10-24T09:26:46+02:00')).toBe('2026-10-24T07:26:46.000Z');
    expect(toIsoUtc('')).toBeNull();
    expect(toIsoUtc('garbage')).toBeNull();
    expect(toIsoUtc(undefined)).toBeNull();
  });
});

describe('dedupeObs', () => {
  it('one per station+fuel, newest observedAt wins', () => {
    const a = obs(24, '2026-10-24T08:00:00.000Z', { station: { id: 's1' } });
    const b = obs(23, '2026-10-24T09:00:00.000Z', { station: { id: 's1' } });
    const c = obs(26, '2026-10-24T08:00:00.000Z', { station: { id: 's1' }, fuel: 'petrol95' });
    const r = dedupeObs([[a, c], [b]]);
    expect(r).toHaveLength(2);
    expect(r.find((o) => o.fuel === 'diesel')!.price).toBe(23);
  });
});

describe('fetchDrivstoffapp', () => {
  it('CENTRES: 3 points, all within 25 km of Oslo S', () => {
    expect(CENTRES).toHaveLength(3);
    for (const c of CENTRES) expect(haversineKm(OSLO_S, c)).toBeLessThan(25);
  });

  it('calls 3 centres with the documented params and User-Agent, dedupes across centres', async () => {
    const { fetchFn, calls } = fakeFetch(() => nearby);
    const r = await fetchDrivstoffapp(fetchFn);
    expect(calls).toHaveLength(3);
    for (const [i, c] of calls.entries()) {
      const u = new URL(c.url);
      expect(u.origin + u.pathname).toBe('https://backend.drivstoffapp.no/stations/fuel/nearby');
      expect(u.searchParams.get('lat')).toBe(String(CENTRES[i]!.lat));
      expect(u.searchParams.get('lng')).toBe(String(CENTRES[i]!.lon));
      expect(u.searchParams.get('radius')).toBe('12');
      expect(u.searchParams.get('limit')).toBe('100');
      expect(u.searchParams.get('include_no_price')).toBe('false');
      expect(c.headers.get('user-agent')).toBe(USER_AGENT);
      expect(c.headers.get('authorization')).toBeNull();
    }
    expect(r).toHaveLength(45); // same fixture three times -> deduped
  });

  it('HTTP error on any centre rejects', async () => {
    let n = 0;
    const { fetchFn } = fakeFetch(() => (++n === 2 ? new Response('down', { status: 503 }) : nearby));
    await expect(fetchDrivstoffapp(fetchFn)).rejects.toThrow(/503/);
  });

  it('non-empty array with nothing mappable rejects (renamed fields)', async () => {
    const renamed = [{ id: 'a', location: { latitude: 59.9, longitude: 10.7 }, prices: { diesel: 24 } }];
    const { fetchFn } = fakeFetch(() => renamed);
    await expect(fetchDrivstoffapp(fetchFn)).rejects.toThrow(/format change/);
  });

  it('all-empty responses resolve to []', async () => {
    const { fetchFn } = fakeFetch(() => []);
    expect(await fetchDrivstoffapp(fetchFn)).toEqual([]);
  });
});

describe('FRED (recorded DDFUELNYH fixture)', () => {
  it('parses date,value rows and skips the header', () => {
    const r = parseFredCsv(fredCsv, 'ulsd_usd_gal');
    expect(r).toHaveLength(35); // 36 data rows, 2026-09-07 (Labor Day) is blank
    expect(r[0]).toEqual({ day: '2026-09-01', series: 'ulsd_usd_gal', value: 4.724 });
    expect(r.at(-1)).toEqual({ day: '2026-10-20', series: 'ulsd_usd_gal', value: 5.265 });
  });
  it("skips '.', blank values, junk; tolerates CRLF", () => {
    const csv = 'observation_date,DDFUELNYH\r\n2026-10-01,.\r\n2026-10-02,\r\n2026-10-03,2.5\r\nfoo,bar\r\n\r\n';
    expect(parseFredCsv(csv, 's')).toEqual([{ day: '2026-10-03', series: 's', value: 2.5 }]);
  });
  it('fetchFred: URL with id + cosd = now - 60 days, User-Agent', async () => {
    const { fetchFn, calls } = fakeFetch(() => fredCsv);
    const r = await fetchFred('DDFUELNYH', 'ulsd_usd_gal', fetchFn, { now: new Date('2026-10-24T06:30:00Z') });
    expect(r).toHaveLength(35); // 36 data rows, 2026-09-07 (Labor Day) is blank
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://fred.stlouisfed.org/graph/fredgraph.csv');
    expect(u.searchParams.get('id')).toBe('DDFUELNYH');
    expect(u.searchParams.get('cosd')).toBe('2026-08-25');
    expect(calls[0]!.headers.get('user-agent')).toBe(USER_AGENT);
  });
  it('fetchFred rejects on HTTP error', async () => {
    const { fetchFn } = fakeFetch(() => new Response('', { status: 500 }));
    await expect(fetchFred('DDFUELNYH', 'x', fetchFn)).rejects.toThrow(/500/);
  });
});

describe('Norges Bank (recorded USD/NOK fixture)', () => {
  it('parses TIME_PERIOD / OBS_VALUE into usdnok', () => {
    const r = parseNorgesBankCsv(nbCsv);
    expect(r).toHaveLength(30);
    expect(r[0]).toEqual({ day: '2026-09-14', series: 'usdnok', value: 9.3213 });
    expect(r.at(-1)).toEqual({ day: '2026-10-23', series: 'usdnok', value: 9.3509 });
  });
  it('header-less input falls back to the last two columns; decimal comma accepted', () => {
    expect(parseNorgesBankCsv('B;x;2026-10-23;9,35\n')).toEqual([{ day: '2026-10-23', series: 'usdnok', value: 9.35 }]);
  });
  it('empty / HTML -> []', () => {
    expect(parseNorgesBankCsv('')).toEqual([]);
    expect(parseNorgesBankCsv('<html>oops</html>')).toEqual([]);
  });
  it('fetchUsdNok: lastNObservations=60, csv, User-Agent', async () => {
    const { fetchFn, calls } = fakeFetch(() => nbCsv);
    expect(await fetchUsdNok(fetchFn)).toHaveLength(30);
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe('/api/data/EXR/B.USD.NOK.SP');
    expect(u.searchParams.get('format')).toBe('csv');
    expect(u.searchParams.get('lastNObservations')).toBe('60');
    expect(calls[0]!.headers.get('user-agent')).toBe(USER_AGENT);
  });
});
