// QA black-box tests for src/core (geo, stats, osloLevel, wdi). Spec: docs/04 "Shared definitions", docs/01 §3, contract.
import { describe, it, expect } from 'vitest';
import { OSLO_S, haversineKm } from '../../src/core/geo';
import { median } from '../../src/core/stats';
import { osloLevel } from '../../src/core/osloLevel';
import { computeWdi } from '../../src/core/wdi';
import type { MarketPoint } from '../../src/types';
import { mkObs, hoursBefore, northOf, NOW, KM_PER_DEG_LAT } from './helpers';

describe('QA-GEO geo', () => {
  it('QA-GEO-01 OSLO_S is 59.9111, 10.7528 (docs/04)', () => {
    expect(OSLO_S.lat).toBeCloseTo(59.9111, 6);
    expect(OSLO_S.lon).toBeCloseTo(10.7528, 6);
  });
  it('QA-GEO-02 haversine: zero, symmetric, 1° latitude ≈ 111.2 km', () => {
    expect(haversineKm(OSLO_S, OSLO_S)).toBe(0);
    const a = { lat: 59.9111, lon: 10.7528 }, b = { lat: 60.9111, lon: 10.7528 };
    expect(haversineKm(a, b)).toBeCloseTo(KM_PER_DEG_LAT, 0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
  it('QA-GEO-03 haversine Oslo S → Bergen ≈ 305 km (±1 %), → Fredensborg ≈ 1.07 km', () => {
    const d = haversineKm(OSLO_S, { lat: 60.3913, lon: 5.3221 });
    expect(d).toBeGreaterThan(302);
    expect(d).toBeLessThan(309);
    expect(haversineKm(OSLO_S, { lat: 59.92082, lon: 10.75106 })).toBeCloseTo(1.07, 1);
  });
});

describe('QA-MED median', () => {
  it('QA-MED-01 empty → null', () => expect(median([])).toBeNull());
  it('QA-MED-02 odd count → middle of sorted', () => expect(median([3, 1, 2])).toBe(2));
  it('QA-MED-03 even count → mean of the two middles', () => expect(median([4, 1, 3, 2])).toBe(2.5));
  it('QA-MED-04 single value, duplicates, unsorted', () => {
    expect(median([7])).toBe(7);
    expect(median([5, 5, 1, 9])).toBe(5);
    expect(median([24.77, 23.07, 26.15])).toBe(24.77);
  });
  it('QA-MED-05 does not mutate its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
  it('QA-MED-06 numeric (not lexicographic) sort', () => expect(median([10, 9, 100])).toBe(10));
});

describe('QA-LVL osloLevel (docs/04 shared definitions)', () => {
  const fresh = (n: number, base = 24, over: Parameters<typeof mkObs>[2] = {}) =>
    Array.from({ length: n }, (_, i) => mkObs(base + i * 0.01, hoursBefore(NOW, 1), over));

  it('QA-LVL-01 null when nFresh < 30 (29 fresh)', () => {
    expect(osloLevel(fresh(29), NOW)).toBeNull();
  });
  it('QA-LVL-02 non-null at exactly 30 fresh; median + nFresh correct (even n)', () => {
    const r = osloLevel(fresh(30), NOW);
    expect(r).not.toBeNull();
    expect(r!.nFresh).toBe(30);
    expect(r!.median).toBeCloseTo(24.145, 6); // (24.14+24.15)/2
  });
  it('QA-LVL-03 odd n median', () => {
    const r = osloLevel(fresh(31), NOW);
    expect(r!.median).toBeCloseTo(24.15, 6);
    expect(r!.nFresh).toBe(31);
  });
  it('QA-LVL-04 empty input → null', () => expect(osloLevel([], NOW)).toBeNull());
  it('QA-LVL-05 stale prices (> 6 h) excluded; exactly 6 h counts as fresh (≤ 6 h)', () => {
    const obs = fresh(29);
    const stale = mkObs(10, hoursBefore(NOW, 6 + 1 / 60));
    expect(osloLevel([...obs, stale], NOW)).toBeNull();
    const edge = mkObs(24.5, hoursBefore(NOW, 6));
    const r = osloLevel([...obs, edge], NOW);
    expect(r).not.toBeNull();
    expect(r!.nFresh).toBe(30);
  });
  it('QA-LVL-06 stations beyond 25 km of Oslo S excluded; 24.9 km included', () => {
    const obs = fresh(29);
    const inside = mkObs(24.5, hoursBefore(NOW, 1), { station: northOf(24.9) });
    const outside = mkObs(10, hoursBefore(NOW, 1), { station: northOf(25.2) });
    const drammen = mkObs(10, hoursBefore(NOW, 1), { station: { lat: 59.744, lon: 10.2045 } });
    expect(osloLevel([...obs, outside, drammen], NOW)).toBeNull();
    expect(osloLevel([...obs, inside, outside], NOW)?.nFresh).toBe(30);
  });
  it('QA-LVL-07 default fuel is diesel: petrol prices ignored', () => {
    const obs = [...fresh(30), ...fresh(10, 99, { fuel: 'petrol95' })];
    const r = osloLevel(obs, NOW);
    expect(r!.nFresh).toBe(30);
    expect(r!.median).toBeCloseTo(24.145, 6);
    expect(osloLevel(fresh(30, 24, { fuel: 'petrol95' }), NOW)).toBeNull();
  });
  it('QA-LVL-08 opts override fuel/radius/freshHours/minFresh', () => {
    expect(osloLevel(fresh(5, 26, { fuel: 'petrol95' }), NOW, { fuel: 'petrol95', minFresh: 5 })?.nFresh).toBe(5);
    expect(osloLevel(fresh(3), NOW, { minFresh: 3 })?.median).toBeCloseTo(24.01, 6);
    const far = Array.from({ length: 3 }, () => mkObs(24, hoursBefore(NOW, 1), { station: northOf(30) }));
    expect(osloLevel(far, NOW, { minFresh: 3, radiusKm: 35 })?.nFresh).toBe(3);
    const old = Array.from({ length: 3 }, () => mkObs(24, hoursBefore(NOW, 10)));
    expect(osloLevel(old, NOW, { minFresh: 3 })).toBeNull();
    expect(osloLevel(old, NOW, { minFresh: 3, freshHours: 12 })?.nFresh).toBe(3);
  });
  it('QA-LVL-09 accepts the API-style timestamp only if normalised (observedAt is ISO "...Z")', () => {
    // contract: observedAt ISO-8601 UTC; osloLevel must treat it as UTC (not local time)
    const obs = Array.from({ length: 30 }, () => mkObs(24, '2026-10-24T04:30:00.000Z'));
    expect(osloLevel(obs, NOW)?.nFresh).toBe(30); // 5.5 h old in UTC
    const obs2 = Array.from({ length: 30 }, () => mkObs(24, '2026-10-24T03:30:00.000Z'));
    expect(osloLevel(obs2, NOW)).toBeNull(); // 6.5 h old
  });
});

describe('QA-WDI computeWdi (docs/01 §3)', () => {
  const u = (day: string, value: number): MarketPoint => ({ day, series: 'ulsd_usd_gal', value });
  const fx = (day: string, value: number): MarketPoint => ({ day, series: 'usdnok', value });
  const f = (ulsd: number, nok: number) => (ulsd / 3.78541) * nok;

  it('QA-WDI-01 formula ULSD ÷ 3.78541 × USD/NOK, series wdi_nok_l, same day', () => {
    const r = computeWdi([u('2026-10-20', 5.265)], [fx('2026-10-20', 9.3843)]);
    expect(r).toHaveLength(1);
    expect(r[0].day).toBe('2026-10-20');
    expect(r[0].series).toBe('wdi_nok_l');
    expect(r[0].value).toBeCloseTo(f(5.265, 9.3843), 6);
    expect(r[0].value).toBeCloseTo(13.0523, 3);
  });
  it('QA-WDI-02 FX carry-forward from the latest earlier day (weekend/holiday)', () => {
    const r = computeWdi([u('2026-10-19', 5.173)], [fx('2026-10-15', 9.0), fx('2026-10-16', 9.441)]);
    expect(r).toHaveLength(1);
    expect(r[0].value).toBeCloseTo(f(5.173, 9.441), 6);
  });
  it('QA-WDI-03 never looks ahead: a later FX value is not used', () => {
    const r = computeWdi([u('2026-10-16', 5.102)], [fx('2026-10-15', 9.5039), fx('2026-10-17', 1)]);
    expect(r[0].value).toBeCloseTo(f(5.102, 9.5039), 6);
  });
  it('QA-WDI-04 ULSD day with no FX on or before it → no WDI point', () => {
    const r = computeWdi([u('2026-09-10', 5.17), u('2026-09-15', 5.338)], [fx('2026-09-14', 9.3213)]);
    expect(r.map((p) => p.day)).toEqual(['2026-09-15']);
  });
  it('QA-WDI-05 unsorted inputs give the same result as sorted ones', () => {
    const U = [u('2026-10-20', 5.265), u('2026-10-16', 5.102), u('2026-10-19', 5.173)];
    const F = [fx('2026-10-20', 9.3843), fx('2026-10-14', 9.4716), fx('2026-10-16', 9.441)];
    const r = computeWdi(U, F);
    const byDay = Object.fromEntries(r.map((p) => [p.day, p.value]));
    expect(Object.keys(byDay).sort()).toEqual(['2026-10-16', '2026-10-19', '2026-10-20']);
    expect(byDay['2026-10-19']).toBeCloseTo(f(5.173, 9.441), 6);
    expect(byDay['2026-10-16']).toBeCloseTo(f(5.102, 9.441), 6);
  });
  it('QA-WDI-06 empty inputs → []', () => {
    expect(computeWdi([], [])).toEqual([]);
    expect(computeWdi([u('2026-10-20', 5)], [])).toEqual([]);
    expect(computeWdi([], [fx('2026-10-20', 9)])).toEqual([]);
  });
});
