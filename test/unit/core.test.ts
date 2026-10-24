import { describe, expect, it } from 'vitest';
import { haversineKm, OSLO_S } from '../../src/core/geo';
import { median } from '../../src/core/stats';
import { osloLevel } from '../../src/core/osloLevel';
import { computeWdi } from '../../src/core/wdi';
import { osloDate } from '../../src/core/time';
import { changedObs, uniqueStations } from '../../src/core/changes';
import { jobHealth } from '../../src/core/health';
import { loadConfig, DEFAULTS } from '../../src/config';
import type { MarketPoint } from '../../src/types';
import { obs } from './helpers';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const hAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('geo', () => {
  it('OSLO_S is Oslo S', () => expect(OSLO_S).toEqual({ lat: 59.9111, lon: 10.7528 }));
  it('zero distance to itself', () => expect(haversineKm(OSLO_S, OSLO_S)).toBe(0));
  it('1 degree latitude is about 111.2 km, symmetric', () => {
    const b = { lat: 60.9111, lon: 10.7528 };
    expect(haversineKm(OSLO_S, b)).toBeCloseTo(111.19, 1);
    expect(haversineKm(b, OSLO_S)).toBeCloseTo(haversineKm(OSLO_S, b), 9);
  });
  it('Oslo S to the Fredensborg station is about 1.08 km', () => {
    expect(haversineKm(OSLO_S, { lat: 59.92082, lon: 10.75106 })).toBeCloseTo(1.08, 1);
  });
});

describe('median', () => {
  it('empty -> null', () => expect(median([])).toBeNull());
  it('odd', () => expect(median([3, 1, 2])).toBe(2));
  it('even -> mean of middle two', () => expect(median([4, 1, 3, 2])).toBe(2.5));
  it('single', () => expect(median([24.77])).toBe(24.77));
  it('does not mutate input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('osloLevel (docs/04 shared definitions)', () => {
  const many = (n: number, price = 24, age = 1) => Array.from({ length: n }, (_, i) => obs(price + i * 0.01, hAgo(age)));

  it('null when fewer than 30 fresh', () => expect(osloLevel(many(29), NOW)).toBeNull());
  it('median of 30 fresh diesel prices', () => {
    const r = osloLevel(many(30), NOW)!;
    expect(r.nFresh).toBe(30);
    expect(r.median).toBeCloseTo(24.145, 6);
  });
  it('exactly 6 h old is fresh, 6 h + 1 s is not', () => {
    expect(osloLevel([...many(29), obs(30, hAgo(6))], NOW)?.nFresh).toBe(30);
    const stale = obs(30, new Date(NOW.getTime() - 6 * 3_600_000 - 1000).toISOString());
    expect(osloLevel([...many(29), stale], NOW)).toBeNull();
  });
  it('ignores other fuels and stations beyond 25 km', () => {
    const far = obs(10, hAgo(1), { station: { lat: OSLO_S.lat + 26 / 111.19 } });
    const petrol = obs(10, hAgo(1), { fuel: 'petrol95' });
    const flat = many(30).map((o) => ({ ...o, price: 24 }));
    expect(osloLevel([...flat, far, petrol], NOW)).toEqual({ median: 24, nFresh: 30 });
  });
  it('options: fuel, radiusKm, freshHours, minFresh', () => {
    const xs = [obs(25, hAgo(10), { fuel: 'petrol95' }), obs(27, hAgo(11), { fuel: 'petrol95' })];
    expect(osloLevel(xs, NOW, { fuel: 'petrol95', freshHours: 12, minFresh: 2 })).toEqual({ median: 26, nFresh: 2 });
    expect(osloLevel(xs, NOW, { fuel: 'petrol95', freshHours: 12, minFresh: 2, radiusKm: -1 })).toBeNull();
  });
  it('one price per station: the newest wins', () => {
    const a = obs(20, hAgo(2), { station: { id: 'dup' } });
    const b = obs(22, hAgo(1), { station: { id: 'dup' } });
    expect(osloLevel([a, b], NOW, { minFresh: 1 })).toEqual({ median: 22, nFresh: 1 });
  });
  it('unparseable observedAt is ignored', () => {
    expect(osloLevel([obs(20, 'not a date')], NOW, { minFresh: 1 })).toBeNull();
  });
});

describe('computeWdi (docs/01 section 3)', () => {
  const p = (day: string, series: string, value: number): MarketPoint => ({ day, series, value });
  it('formula ulsd / 3.78541 * usdnok', () => {
    const r = computeWdi([p('2026-10-20', 'ulsd_usd_gal', 3.78541)], [p('2026-10-20', 'usdnok', 10)]);
    expect(r).toEqual([{ day: '2026-10-20', series: 'wdi_nok_l', value: 10 }]);
  });
  it('uses the latest earlier FX day (weekend / holiday gap); skips ULSD days before any FX', () => {
    const r = computeWdi(
      [p('2026-10-16', 'u', 5), p('2026-10-19', 'u', 5), p('2026-10-14', 'u', 5)],
      [p('2026-10-19', 'usdnok', 9.5), p('2026-10-15', 'usdnok', 9)],
    );
    expect(r.map((x) => x.day)).toEqual(['2026-10-16', '2026-10-19']);
    expect(r[0]!.value).toBeCloseTo((5 / 3.78541) * 9, 9);
    expect(r[1]!.value).toBeCloseTo((5 / 3.78541) * 9.5, 9);
  });
  it('empty inputs -> []', () => {
    expect(computeWdi([], [p('2026-10-19', 'usdnok', 9)])).toEqual([]);
    expect(computeWdi([p('2026-10-19', 'u', 5)], [])).toEqual([]);
  });
});

describe('osloDate (Europe/Oslo)', () => {
  it('summer time: 22:30Z is already the next Oslo day', () => expect(osloDate(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02'));
  it('winter time: 22:30Z same Oslo day, 23:30Z next', () => {
    expect(osloDate(new Date('2026-12-01T22:30:00Z'))).toBe('2026-12-01');
    expect(osloDate(new Date('2026-12-01T23:30:00Z'))).toBe('2026-12-02');
  });
});

describe('changedObs / uniqueStations', () => {
  it('new, changed price and changed observedAt are kept; identical dropped', () => {
    const t = '2026-10-24T08:00:00.000Z';
    const same = obs(24, t, { station: { id: 'a' } });
    const newer = obs(24, '2026-10-24T09:00:00.000Z', { station: { id: 'b' } });
    const cheaper = obs(23, t, { station: { id: 'c' } });
    const fresh = obs(25, t, { station: { id: 'd' } });
    const latest = new Map([
      ['a|diesel', { price: 24, observedAt: t }],
      ['b|diesel', { price: 24, observedAt: t }],
      ['c|diesel', { price: 24, observedAt: t }],
    ]);
    expect(changedObs([same, newer, cheaper, fresh], latest).map((o) => o.station.id)).toEqual(['b', 'c', 'd']);
  });
  it('uniqueStations dedupes by id', () => {
    const a = obs(1, 'x', { station: { id: 'a' } });
    const a2 = obs(2, 'x', { station: { id: 'a' }, fuel: 'petrol95' });
    expect(uniqueStations([a, a2])).toHaveLength(1);
  });
});

describe('jobHealth', () => {
  it('no runs', () => expect(jobHealth([])).toEqual({ lastRun: null, lastOk: null, lastError: null, consecutiveFailures: 0 }));
  it('newest first: failures since last ok, extras from last ok', () => {
    const h = jobHealth(
      [
        { startedAt: 'c', finishedAt: 'c2', ok: 0, detail: { error: 'boom' } },
        { startedAt: 'b', finishedAt: null, ok: null, detail: {} },
        { startedAt: 'a', finishedAt: 'a2', ok: 1, detail: { nFresh: 57 } },
      ],
      ['nFresh'],
    );
    expect(h).toEqual({
      lastRun: { at: 'c', ok: false },
      lastOk: 'a2',
      lastError: { at: 'c2', error: 'boom' },
      consecutiveFailures: 2,
      nFresh: 57,
    });
  });
});

describe('loadConfig (docs/03 config)', () => {
  it('parses the wrangler.toml example vars', () => {
    const c = loadConfig({
      HOME_LAT: '59.93', HOME_LON: '10.80', FUEL: 'diesel', TANK_L: '50', CONSUMPTION_L100: '6.5',
      SENSITIVITY: 'eager', QUIET_HOURS: '22-07', ALLOWED_CHAT_IDS: '123, 456',
    });
    expect(c).toEqual({
      home: { lat: 59.93, lon: 10.8 }, fuel: 'diesel', tankL: 50, consumptionL100: 6.5,
      sensitivity: 'eager', quietHours: { from: 22, to: 7 }, allowedChatIds: [123, 456],
    });
  });
  it('bad or missing values fall back to defaults', () => {
    expect(loadConfig({ FUEL: 'kerosene', TANK_L: 'lots', SENSITIVITY: 'max', QUIET_HOURS: 'night' })).toEqual(DEFAULTS);
  });
});
