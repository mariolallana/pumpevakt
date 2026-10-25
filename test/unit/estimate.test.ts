import { describe, expect, it } from 'vitest';
import { estimatePump } from '../../src/core/estimate';

describe('estimatePump', () => {
  const days = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
  // Fri 16, Mon 19 and Tue 20 published; the weekend carries Friday's value.
  const wdi = [
    { day: '2026-10-16', value: 12 },
    { day: '2026-10-19', value: 12.5 },
    { day: '2026-10-20', value: 13 },
  ];

  it('adds the median recorded gap to the latest WDI on or before each day before recording', () => {
    const spread = [
      { day: '2026-10-21', am: { p50: 24 }, pm: { p50: 27 } }, // level 25.5, WDI (20th) 13 → gap 12.5
      { day: '2026-10-22', pm: { p50: 26 } }, //                   level 26,   WDI 13 → gap 13
    ];
    const e = estimatePump(spread, wdi, days)!;
    expect(e.nCal).toBe(2);
    expect(e.gap).toBe(12.75);
    expect(e.points).toEqual([
      { day: '2026-10-17', value: 24.75 },
      { day: '2026-10-18', value: 24.75 },
      { day: '2026-10-19', value: 25.25 },
      { day: '2026-10-20', value: 25.75 },
    ]);
  });

  it('never estimates on or after the first recorded day', () => {
    const e = estimatePump([{ day: '2026-10-19', am: { p50: 25 } }], wdi, days)!;
    expect(e.points.map((p) => p.day)).toEqual(['2026-10-17', '2026-10-18']);
  });

  it('skips days with no WDI yet and returns null without calibration', () => {
    const late = [{ day: '2026-10-19', value: 12.5 }];
    expect(estimatePump([{ day: '2026-10-21', am: { p50: 25 } }], late, days)!.points.map((p) => p.day)).toEqual(['2026-10-19', '2026-10-20']);
    expect(estimatePump([], wdi, days)).toBeNull();
    expect(estimatePump([{ day: '2026-10-21', am: { p50: 25 } }], [], days)).toBeNull();
  });
});
