import { describe, expect, it } from 'vitest';
import { amLevels, chainOf, type BrandedReport } from '../../src/core/chains';
import { norm, verdict } from '../../src/core/outlook';

describe('chainOf', () => {
  it('maps drivstoffapp brands to chains', () => {
    const brands = ['Circle K', 'Circle K Automat', 'Uno X', 'Uno-X 7-Eleven', 'Uno X TRUCK', 'Esso Express', 'ST1', 'YX', 'Automat 1', '', null];
    expect(brands.map(chainOf)).toEqual(['circlek', 'circlek', 'unox', 'unox', 'unox', 'esso', 'st1', 'other', 'other', 'other', 'other']);
  });
});

describe('amLevels', () => {
  // 2026-10-24 is CEST (UTC+2): the 06–12 Oslo window is 04:00–09:59 UTC.
  const r = (id: string, brand: string, price: number, utc: string, fuel = 'diesel'): BrandedReport => ({
    stationId: id,
    brand,
    fuel,
    price,
    observedAt: `2026-10-24T${utc}:00.000Z`,
  });
  const ck = [24.9, 25.0, 25.1, 24.8, 25.2].map((p, i) => r(`ck${i}`, 'Circle K', p, '06:00'));

  it("per chain and all: median of each station's latest morning price, ≥ 5 stations", () => {
    const pts = amLevels([...ck, r('u1', 'Uno X', 24, '06:00'), r('ck0', 'Circle K', 26.0, '09:30')], '2026-10-24');
    expect(pts).toContainEqual({ day: '2026-10-24', series: 'am_circlek_diesel', value: 25.1 }); // ck0's later 26.0 wins
    expect(pts).toContainEqual({ day: '2026-10-24', series: 'am_all_diesel', value: 25.05 });
    expect(pts.some((p) => p.series === 'am_unox_diesel')).toBe(false); // 1 station < 5
  });

  it('ignores reports outside 06–12 Oslo time, on other days, and other fuels', () => {
    const outside = [r('x', 'Circle K', 30, '03:59'), r('y', 'Circle K', 30, '10:00'), r('z', 'Circle K', 30, '06:00', 'petrol98')];
    const pts = amLevels([...ck, ...outside], '2026-10-24');
    expect(pts.find((p) => p.series === 'am_circlek_diesel')!.value).toBe(25);
    expect(amLevels(ck, '2026-10-23')).toEqual([]);
  });
});

describe('outlook', () => {
  const rise = { at: '2026-10-24T13:00:00.000Z', before: 25, after: 27.5, now: 27.4 };
  it('verdict: wait while still risen, good once eased, normal without a rise, unknown without data', () => {
    expect(verdict(true, rise)).toBe('wait');
    expect(verdict(true, { ...rise, now: 25.5 })).toBe('good');
    expect(verdict(true, null)).toBe('normal');
    expect(verdict(false, rise)).toBe('unknown');
  });

  it('norm: learning until 5 previous days, then delta vs their median', () => {
    const days = (n: number) => Array.from({ length: n }, (_, i) => ({ day: `2026-10-${String(10 + i).padStart(2, '0')}`, value: 25 + (i % 2) * 0.2 }));
    expect(norm([])).toMatchObject({ level: null, normal: null, nDays: 0 });
    expect(norm(days(5))).toMatchObject({ nDays: 4, normal: null, delta: null });
    expect(norm([...days(6), { day: '2026-10-20', value: 23.6 }])).toMatchObject({ day: '2026-10-20', level: 23.6, nDays: 6, normal: 25.1, delta: -1.5 });
  });
});
