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
  // 2026-10-24 is CEST (UTC+2). Morning 06–12 Oslo = 04:00–09:59 UTC; afternoon 15–24 Oslo = 13:00–21:59 UTC.
  const r = (i: number, price: number, utc: string, fuel = 'diesel'): BrandedReport => ({
    stationId: `s${i}`,
    brand: 'Circle K',
    fuel,
    price,
    observedAt: `2026-10-24T${utc}:00.000Z`,
  });
  const morning = Array.from({ length: 10 }, (_, i) => r(i, 24 + i * 0.2, '07:00')); // 24.0 … 25.8
  const afternoon = Array.from({ length: 10 }, (_, i) => r(i, 27 + i * 0.2, '15:00')); // 27.0 … 28.8

  it('splits the day at the rise: p25/p50/p75 across stations, per window', () => {
    const pts = daySpread([...morning, ...afternoon], '2026-10-24');
    expect(pts).toEqual([
      { day: '2026-10-24', series: 'spread_am_p25_diesel', value: 24.45 },
      { day: '2026-10-24', series: 'spread_am_p50_diesel', value: 24.9 },
      { day: '2026-10-24', series: 'spread_am_p75_diesel', value: 25.35 },
      { day: '2026-10-24', series: 'spread_pm_p25_diesel', value: 27.45 },
      { day: '2026-10-24', series: 'spread_pm_p50_diesel', value: 27.9 },
      { day: '2026-10-24', series: 'spread_pm_p75_diesel', value: 28.35 },
    ]);
  });

  it('one price per station per window: its latest, so a busy station does not dominate', () => {
    const busy = Array.from({ length: 30 }, () => r(0, 30, '05:00')); // station s0 reports 30.00 thirty times, before its 07:00 report
    const pts = daySpread([...busy, ...morning], '2026-10-24');
    expect(pts.find((p) => p.series === 'spread_am_p50_diesel')!.value).toBe(24.9);
  });

  it('needs 10 stations in a window; ignores 12–15 (the rise), other days and other fuels', () => {
    expect(daySpread(morning.slice(1), '2026-10-24')).toEqual([]);
    expect(daySpread(morning.map((x) => ({ ...x, observedAt: '2026-10-24T11:00:00.000Z' })), '2026-10-24')).toEqual([]); // 13:00 Oslo
    expect(daySpread(morning, '2026-10-23')).toEqual([]);
    expect(daySpread(morning.map((x) => ({ ...x, fuel: 'petrol98' })), '2026-10-24')).toEqual([]);
  });
});
