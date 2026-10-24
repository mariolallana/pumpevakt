import { describe, expect, it } from 'vitest';
import { netSavingNok } from '../../src/core/netSaving';
import { buildStations, type StationPriceRow } from '../../src/core/stationList';
import { OSLO_S } from '../../src/core/geo';

describe('netSavingNok (docs/04 §3)', () => {
  it('matches the formula: (L − p) × tank − 2 × km × 1.3 × cons/100 × p, rounded', () => {
    // (24 − 22.5) × 50 = 75; detour 2 × 3 × 1.3 = 7.8 km; 7.8 × 6.5/100 × 22.5 = 11.4075 → 63.5925 → 64
    expect(netSavingNok(24, 22.5, 3, 50, 6.5)).toBe(64);
  });
  it('zero distance = pure price difference × tank', () => {
    expect(netSavingNok(24, 23, 0, 50, 6.5)).toBe(50);
  });
  it('can be negative (pricier and/or far away)', () => {
    expect(netSavingNok(24, 25, 5, 50, 6.5)).toBe(Math.round(-50 - 2 * 5 * 1.3 * 0.065 * 25));
  });
  it('never returns -0', () => {
    expect(Object.is(netSavingNok(24, 24, 0, 50, 6.5), 0)).toBe(true);
    expect(Object.is(netSavingNok(24, 24.004, 0, 50, 6.5), 0)).toBe(true);
  });
});

describe('buildStations', () => {
  const now = new Date('2026-10-24T10:00:00.000Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const north = (km: number) => ({ lat: OSLO_S.lat + km / 111.195, lon: OSLO_S.lon });
  const row = (id: string, price: number, ageH: number, km = 1, over: Partial<StationPriceRow> = {}): StationPriceRow => ({
    id, name: `N${id}`, brand: 'B', address: 'A', ...north(km), price, observedAt: ago(ageH), ...over,
  });
  const base = { fuel: 'diesel' as const, origin: OSLO_S, radiusKm: 10, now, tankL: 50, consumptionL100: 6.5 };

  it('drops > 24 h and out-of-radius rows, flags > 6 h as stale, rounds distance, nulls → empty strings', () => {
    const r = buildStations(
      [row('a', 23, 1), row('b', 23, 7), row('c', 23, 24.01), row('d', 23, 1, 10.5), row('e', 23, 24, 2, { brand: null, address: null })],
      { ...base, osloLevel: 24 },
    );
    expect(r.stations.map((s) => s.id).sort()).toEqual(['a', 'b', 'e']);
    const b = r.stations.find((s) => s.id === 'b')!;
    expect(b.stale).toBe(true);
    expect(b.ageMinutes).toBe(420);
    expect(b.distanceKm).toBe(1);
    const e = r.stations.find((s) => s.id === 'e')!;
    expect(e).toMatchObject({ brand: '', address: '', stale: true, ageMinutes: 1440, distanceKm: 2 });
    expect(r.stations.find((s) => s.id === 'a')!.stale).toBe(false);
  });

  it('uses the Oslo level for diesel and sorts by net saving desc, then price asc', () => {
    const r = buildStations([row('far', 22, 1, 9), row('near', 22.4, 1, 0.5), row('tie1', 23, 1, 2), row('tie0', 23, 1, 2)], { ...base, osloLevel: 24 });
    expect(r.refPrice).toBe(24);
    expect(r.stations.map((s) => s.id)).toEqual(['near', 'far', 'tie0', 'tie1']);
    for (const s of r.stations) expect(s.netSavingNok).toBe(netSavingNok(24, s.price, s.distanceKm, 50, 6.5));
  });

  it('fresh (≤ 6 h) rows always rank before stale ones, each group by net saving desc (IMPL-W12)', () => {
    const r = buildStations([row('staleBig', 20, 8), row('fresh', 23.5, 1), row('freshBetter', 23, 1), row('staleSmall', 23.9, 7)], { ...base, osloLevel: 24 });
    expect(r.stations.map((s) => s.id)).toEqual(['freshBetter', 'fresh', 'staleBig', 'staleSmall']);
  });

  it('falls back to the median of fresh (≤ 6 h) prices in the radius when there is no level or fuel ≠ diesel', () => {
    const rows = [row('a', 20, 1), row('b', 22, 2), row('c', 30, 1), row('stale', 10, 8)];
    expect(buildStations(rows, { ...base, osloLevel: null }).refPrice).toBe(22);
    expect(buildStations(rows, { ...base, fuel: 'petrol95', osloLevel: 24 }).refPrice).toBe(22);
  });

  it('refPrice null → every netSavingNok null, sorted by price', () => {
    const r = buildStations([row('x', 23, 7), row('y', 22, 8)], { ...base, osloLevel: null });
    expect(r.refPrice).toBeNull();
    expect(r.stations.map((s) => [s.id, s.netSavingNok])).toEqual([['y', null], ['x', null]]);
  });

  it('echoes fuel, origin, radius and generatedAt', () => {
    expect(buildStations([], { ...base, osloLevel: 24 })).toEqual({
      fuel: 'diesel', origin: OSLO_S, radiusKm: 10, refPrice: 24, generatedAt: now.toISOString(),
      coverage: { current: 0, outdated: 0, jumpDetected: false }, stations: [],
    });
  });
});
