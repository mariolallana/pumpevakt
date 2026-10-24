import { describe, expect, it } from 'vitest';
import type { BrandedReport } from '../../src/core/chains';
import { daySpread, percentile } from '../../src/core/dailySpread';

describe('percentile', () => {
  it('interpolates linearly between ranks', () => {
    const xs = [1, 2, 3, 4, 5];
    expect([0, 25, 50, 75, 100].map((q) => percentile(xs, q))).toEqual([1, 2, 3, 4, 5]);
    expect(percentile([10, 20], 25)).toBe(12.5);
    expect(percentile([7], 75)).toBe(7);
  });
});

describe('daySpread', () => {
  const r = (i: number, price: number, at: string, fuel = 'diesel'): BrandedReport => ({ stationId: `s${i}`, brand: 'Circle K', fuel, price, observedAt: at });
  // 20 diesel reports on 2026-10-24 (Oslo): 24.00, 24.10, … 25.90
  const day = Array.from({ length: 20 }, (_, i) => r(i, 24 + i * 0.1, '2026-10-24T08:00:00.000Z'));

  it('p25/p50/p75 of every report that Oslo day, per fuel, from 20 reports', () => {
    expect(daySpread(day, '2026-10-24')).toEqual([
      { day: '2026-10-24', series: 'p25_diesel', value: 24.48 },
      { day: '2026-10-24', series: 'p50_diesel', value: 24.95 },
      { day: '2026-10-24', series: 'p75_diesel', value: 25.42 },
    ]);
  });

  it('uses the Oslo date (23:30 UTC on the 23rd is the 24th in Oslo) and skips thin days', () => {
    const late = r(99, 30, '2026-10-23T22:30:00.000Z');
    expect(daySpread([...day.slice(1), late], '2026-10-24').find((p) => p.series === 'p75_diesel')!.value).toBeGreaterThan(25.42);
    expect(daySpread(day.slice(0, 19), '2026-10-24')).toEqual([]);
    expect(daySpread(day.map((x) => ({ ...x, fuel: 'petrol98' })), '2026-10-24')).toEqual([]);
  });
});
