// QA black-box tests for src/sources/*. Spec: docs/01 §2–3, docs/05 §4, docs/02 §4, contract.
import { describe, it, expect } from 'vitest';
import { CENTRES, mapStations, dedupeObs, fetchDrivstoffapp } from '../../src/sources/drivstoffapp';
import { parseFredCsv, fetchFred } from '../../src/sources/fred';
import { parseNorgesBankCsv, fetchUsdNok } from '../../src/sources/norgesBank';
import { haversineKm, OSLO_S } from '../../src/core/geo';
import type { StationObs } from '../../src/types';
import { fixtures, fakeFetch, json, text, sourcesRouter, PROJECT_UA, mkObs } from './helpers';

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const find = (obs: StationObs[], id: string, fuel: string) => obs.filter((o) => o.station.id === id && o.fuel === fuel);

describe('QA-MAP drivstoffapp mapStations (docs/01 §2)', () => {
  const obs = mapStations(fixtures.realStations);

  it('QA-MAP-01 recorded live fixture → 45 observations, 13 diesel', () => {
    expect(obs).toHaveLength(45);
    expect(obs.filter((o) => o.fuel === 'diesel')).toHaveLength(13);
  });
  it('QA-MAP-02 field mapping: diesel/gasoline/octane/hvo100 → diesel/petrol95/petrol98/hvo100', () => {
    const id = 'iyu9081651bbrj2'; // Etterstad, all four fuels
    expect(find(obs, id, 'diesel')[0].price).toBe(23.78);
    expect(find(obs, id, 'petrol95')[0].price).toBe(26.74);
    expect(find(obs, id, 'petrol98')[0].price).toBe(21.87);
    expect(find(obs, id, 'hvo100')[0].price).toBe(24.39);
    expect(new Set(obs.map((o) => o.fuel))).toEqual(new Set(['diesel', 'petrol95', 'petrol98', 'hvo100']));
  });
  it('QA-MAP-03 station fields: id, name, brand, address, lat/lon from location', () => {
    const s = find(obs, 'j1i4da8bf8wkcql', 'diesel')[0].station;
    expect(s).toMatchObject({ id: 'j1i4da8bf8wkcql', name: 'Fredensborg', brand: 'Uno X', address: 'Maridalsveien 10, 0178 Oslo' });
    expect(s.lat).toBeCloseTo(59.92082191643188, 9);
    expect(s.lon).toBeCloseTo(10.75106396077194, 9);
  });
  it('QA-MAP-04 per-fuel updated_at becomes observedAt, as ISO-8601 UTC with T and Z', () => {
    const d = find(obs, 'j1i4da8bf8wkcql', 'diesel')[0];
    const p98 = find(obs, 'j1i4da8bf8wkcql', 'petrol98')[0];
    expect(Date.parse(d.observedAt)).toBe(Date.parse('2026-10-24T07:26:46.000Z'));
    expect(Date.parse(p98.observedAt)).toBe(Date.parse('2026-10-12T05:34:30.059Z'));
    for (const o of obs) expect(o.observedAt).toMatch(ISO_Z);
  });
  it('QA-MAP-05 fd_price is ignored (Storo: diesel 24.58, fd 24.74 → only 24.58)', () => {
    const d = find(obs, 'ohbvhgro31z85n3', 'diesel');
    expect(d).toHaveLength(1);
    expect(d[0].price).toBe(24.58);
    expect(obs.some((o) => o.price === 24.74 || o.price === 22.34 || o.price === 22.43)).toBe(false);
  });
  it('QA-MAP-06 null prices produce no observation (Kongshavn diesel null)', () => {
    expect(find(obs, 'yof1t4kxboxd6b1', 'diesel')).toHaveLength(0);
    expect(find(obs, 'yof1t4kxboxd6b1', 'petrol95')).toHaveLength(1);
    for (const o of obs) expect(typeof o.price).toBe('number');
  });

  describe('adversarial fixture', () => {
    const adv = mapStations(fixtures.adversarialStations);
    it('QA-MAP-07 fd_price only → no diesel; fd with diesel → the diesel price', () => {
      expect(adv.filter((o) => o.station.id === 'qafdonly000001')).toHaveLength(0);
      const both = find(adv, 'qafdboth000002', 'diesel');
      expect(both).toHaveLength(1);
      expect(both[0].price).toBe(24.1);
      expect(adv.some((o) => o.price === 20 || o.price === 19.9)).toBe(false);
    });
    it('QA-MAP-08 all-null prices → no observations', () => {
      expect(adv.filter((o) => o.station.id === 'qanullall00003')).toHaveLength(0);
    });
    it('QA-MAP-09 missing updated_at object → no observations (price without age)', () => {
      expect(adv.filter((o) => o.station.id === 'qanoupdated004')).toHaveLength(0);
    });
    it('QA-MAP-10 missing per-fuel updated_at key → that fuel skipped, others kept', () => {
      expect(find(adv, 'qamissingkey05', 'diesel')).toHaveLength(0);
      expect(find(adv, 'qamissingkey05', 'petrol95')).toHaveLength(1);
    });
    it('QA-MAP-11 hvo-only station → one hvo100 observation', () => {
      expect(adv.filter((o) => o.station.id === 'qahvo000000010').map((o) => o.fuel)).toEqual(['hvo100']);
    });
    it('QA-MAP-12 every observation has a valid fuel, finite price and parseable observedAt', () => {
      for (const o of adv) {
        expect(['diesel', 'petrol95', 'petrol98', 'hvo100']).toContain(o.fuel);
        expect(Number.isFinite(o.price)).toBe(true);
        expect(Number.isNaN(Date.parse(o.observedAt))).toBe(false);
      }
    });
  });

  it('QA-MAP-13 empty array → []', () => expect(mapStations([])).toEqual([]));
  it('QA-MAP-14 format change (non-array / garbage) throws, so the run counts as failed (docs/09)', () => {
    expect(() => mapStations({ error: 'changed' })).toThrow();
    expect(() => mapStations(null)).toThrow();
    expect(() => mapStations('<html>')).toThrow();
  });
});

describe('QA-DED dedupeObs', () => {
  it('QA-DED-01 dedupes by station.id + fuel across centre lists', () => {
    const a = mkObs(24, '2026-10-24T08:00:00.000Z');
    const aP = { ...a, fuel: 'petrol95' as const, price: 26 };
    const aDup = { ...a, station: { ...a.station } };
    const b = mkObs(23, '2026-10-24T08:00:00.000Z');
    const r = dedupeObs([[a, aP], [aDup, b], []]);
    expect(r).toHaveLength(3);
    expect(r.filter((o) => o.station.id === a.station.id && o.fuel === 'diesel')).toHaveLength(1);
  });
  it('QA-DED-02 the real fixture served three times dedupes to itself', () => {
    const m = mapStations(fixtures.realStations);
    expect(dedupeObs([m, m, m])).toHaveLength(m.length);
  });
  it('QA-DED-03 empty → []', () => expect(dedupeObs([])).toEqual([]));
});

describe('QA-DRV fetchDrivstoffapp (docs/01 §2, docs/02 §4)', () => {
  it('QA-DRV-01 three centres, all within ~15 km of Oslo S, distinct', () => {
    expect(CENTRES).toHaveLength(3);
    for (const c of CENTRES) expect(haversineKm(OSLO_S, c)).toBeLessThan(15);
    expect(new Set(CENTRES.map((c) => `${c.lat},${c.lon}`)).size).toBe(3);
  });
  it('QA-DRV-02 exactly 3 GET calls to /stations/fuel/nearby with radius=12, limit=100, include_no_price=false, lat/lng = CENTRES', async () => {
    const { fn, calls } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: [fixtures.realStations, [], []] }));
    await fetchDrivstoffapp(fn);
    expect(calls).toHaveLength(3);
    const seen = new Set<string>();
    for (const c of calls) {
      expect(c.method.toUpperCase()).toBe('GET');
      expect(c.url.protocol).toBe('https:');
      expect(c.url.hostname).toBe('backend.drivstoffapp.no');
      expect(c.url.pathname).toBe('/stations/fuel/nearby');
      expect(c.url.searchParams.get('radius')).toBe('12');
      expect(c.url.searchParams.get('limit')).toBe('100');
      expect(c.url.searchParams.get('include_no_price')).toBe('false');
      seen.add(`${Number(c.url.searchParams.get('lat'))},${Number(c.url.searchParams.get('lng'))}`);
    }
    expect(seen).toEqual(new Set(CENTRES.map((c) => `${c.lat},${c.lon}`)));
  });
  it('QA-DRV-03 honest User-Agent on every call', async () => {
    const { fn, calls } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: [[], [], []] }));
    await fetchDrivstoffapp(fn);
    for (const c of calls) expect(c.headers.get('user-agent')).toBe(PROJECT_UA);
  });
  it('QA-DRV-04 never uses auth: no Authorization header', async () => {
    const { fn, calls } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: [[], [], []] }));
    await fetchDrivstoffapp(fn);
    for (const c of calls) expect(c.headers.get('authorization')).toBeNull();
  });
  it('QA-DRV-05 combines centres, dedupes duplicates across centres, ignores fd_price', async () => {
    const { fn } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: [fixtures.realStations, fixtures.adversarialStations, fixtures.realStations] }));
    const obs = await fetchDrivstoffapp(fn);
    const keys = obs.map((o) => `${o.station.id}|${o.fuel}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(find(obs, 'j1i4da8bf8wkcql', 'diesel')).toHaveLength(1); // Fredensborg in all three
    expect(obs.filter((o) => o.station.id.startsWith('qafdonly'))).toHaveLength(0);
    // 45 real + adversarial: fdboth(1) + missingkey(1) + low(1?) + high(1?) + stale(1) + far(1) + hvo(1)
    expect(obs.length).toBeGreaterThanOrEqual(45 + 5);
    expect(obs.length).toBeLessThanOrEqual(45 + 7);
  });
  it('QA-DRV-06 all centres failing (HTTP 503) → rejects (counts as failed run)', async () => {
    const { fn } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: [], failDrivstoffapp: true }));
    await expect(fetchDrivstoffapp(fn)).rejects.toBeTruthy();
  });
  it('QA-DRV-07 a fetch signal is passed (timeout support)', async () => {
    const { fn, calls } = fakeFetch(sourcesRouter({ centres: CENTRES, stationsByCentre: [[], [], []] }));
    await fetchDrivstoffapp(fn);
    for (const c of calls) expect(c.signal).toBeTruthy();
  });
});

describe('QA-FRED FRED adapter', () => {
  it('QA-FRED-01 recorded fixture → 56 points (one blank row skipped), series as given', () => {
    const r = parseFredCsv(fixtures.fredCsv, 'ulsd_usd_gal');
    expect(r).toHaveLength(56);
    expect(r[0]).toEqual({ day: '2026-08-03', series: 'ulsd_usd_gal', value: 3.898 });
    expect(r.find((p) => p.day === '2026-10-20')?.value).toBe(5.265);
    expect(r.some((p) => p.day === '2026-09-07')).toBe(false);
    for (const p of r) {
      expect(p.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isFinite(p.value)).toBe(true);
    }
  });
  it("QA-FRED-02 skips '.' and blank values, handles CRLF and trailing blank lines", () => {
    const r = parseFredCsv(fixtures.fredAdversarialCsv, 'ulsd_usd_gal');
    expect(r).toEqual([
      { day: '2026-10-15', series: 'ulsd_usd_gal', value: 4.943 },
      { day: '2026-10-20', series: 'ulsd_usd_gal', value: 5.265 },
    ]);
  });
  it("QA-FRED-03 legacy 'DATE,' header still parses", () => {
    const r = parseFredCsv(fixtures.fredLegacyCsv, 'x');
    expect(r.map((p) => p.day)).toEqual(['2026-10-19', '2026-10-20']);
  });
  it('QA-FRED-04 fetchFred hits fredgraph.csv with id, sends UA and a signal, parses', async () => {
    const { fn, calls } = fakeFetch(sourcesRouter({ centres: [], stationsByCentre: [] }));
    const r = await fetchFred('DDFUELNYH', 'ulsd_usd_gal', fn);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.hostname).toBe('fred.stlouisfed.org');
    expect(calls[0].url.pathname).toBe('/graph/fredgraph.csv');
    expect(calls[0].url.searchParams.get('id')).toBe('DDFUELNYH');
    expect(calls[0].headers.get('user-agent')).toBe(PROJECT_UA);
    expect(calls[0].signal).toBeTruthy();
    expect(r).toHaveLength(56);
    expect(r.every((p) => p.series === 'ulsd_usd_gal')).toBe(true);
  });
  it('QA-FRED-05 HTTP 500 → rejects', async () => {
    const { fn } = fakeFetch(() => text('err', 500));
    await expect(fetchFred('DDFUELNYH', 'ulsd_usd_gal', fn)).rejects.toBeTruthy();
  });
});

describe('QA-NB Norges Bank adapter', () => {
  it('QA-NB-01 recorded fixture → 30 usdnok points', () => {
    const r = parseNorgesBankCsv(fixtures.nbCsv);
    expect(r).toHaveLength(30);
    expect(r[0]).toEqual({ day: '2026-09-14', series: 'usdnok', value: 9.3213 });
    expect(r.find((p) => p.day === '2026-10-23')?.value).toBe(9.3509);
    expect(r.every((p) => p.series === 'usdnok')).toBe(true);
  });
  it('QA-NB-02 CRLF line endings and an empty OBS_VALUE row', () => {
    const lines = fixtures.nbCsv.trim().split(/\r?\n/).slice(0, 3);
    lines.push(lines[2].replace(/;[^;]*$/, ';').replace('2026-09-15', '2026-09-16'));
    const r = parseNorgesBankCsv(lines.join('\r\n') + '\r\n');
    expect(r.map((p) => p.day)).toEqual(['2026-09-14', '2026-09-15']);
  });
  it('QA-NB-03 fetchUsdNok hits EXR/B.USD.NOK.SP as CSV, sends UA and a signal', async () => {
    const { fn, calls } = fakeFetch(sourcesRouter({ centres: [], stationsByCentre: [] }));
    const r = await fetchUsdNok(fn);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.hostname).toBe('data.norges-bank.no');
    expect(calls[0].url.pathname).toBe('/api/data/EXR/B.USD.NOK.SP');
    expect(calls[0].url.searchParams.get('format')).toBe('csv');
    expect(calls[0].headers.get('user-agent')).toBe(PROJECT_UA);
    expect(calls[0].signal).toBeTruthy();
    expect(r).toHaveLength(30);
  });
  it('QA-NB-04 HTTP 500 → rejects', async () => {
    const { fn } = fakeFetch(() => text('err', 500));
    await expect(fetchUsdNok(fn)).rejects.toBeTruthy();
  });
});

describe('QA-TMO 15 s timeout (docs/02 §4, docs/05 §4)', () => {
  // fetch that only settles when its signal aborts
  const hang = (first: boolean) => {
    let n = 0;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const isFirst = n++ === 0;
      if (first && !isFirst) return json([]);
      return new Promise<Response>((_, rej) => {
        const s = init?.signal;
        s?.addEventListener('abort', () => rej(s.reason ?? new Error('aborted')));
      });
    }) as typeof fetch;
  };
  const timed = async (p: Promise<unknown>) => {
    const t0 = Date.now();
    const outcome = await Promise.race([
      p.then(() => 'resolved', () => 'rejected'),
      new Promise((r) => setTimeout(() => r('hung'), 20_000)),
    ]);
    return { outcome, ms: Date.now() - t0 };
  };
  it('QA-TMO-01 drivstoffapp, FRED and Norges Bank each give up after ~15 s', async () => {
    const [d, f, n] = await Promise.all([
      timed(fetchDrivstoffapp(hang(true))),
      timed(fetchFred('DDFUELNYH', 'ulsd_usd_gal', hang(false))),
      timed(fetchUsdNok(hang(false))),
    ]);
    for (const r of [d, f, n]) {
      expect(r.outcome).not.toBe('hung');
      expect(r.ms).toBeGreaterThanOrEqual(14_000);
      expect(r.ms).toBeLessThan(17_000);
    }
    expect(f.outcome).toBe('rejected');
    expect(n.outcome).toBe('rejected');
  }, 25_000);
});
