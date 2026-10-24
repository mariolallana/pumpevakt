import { describe, expect, it } from 'vitest';
import { detectRise, isOutdated } from '../../src/core/rise';

// 2026-10-24 shape: ~25 kr before a ~13:00 UTC rise, ~27.5 after.
const now = Date.parse('2026-10-24T17:00:00Z');
const at = (hhmm: string) => Date.parse(`2026-10-24T${hhmm}:00Z`);
const spread = (price: number, from: string, n: number, everyMin: number) =>
  Array.from({ length: n }, (_, i) => ({ price: price + (i % 3) * 0.1, t: at(from) + i * everyMin * 60_000 }));

describe('detectRise', () => {
  const pre = spread(25.0, '08:00', 30, 10); // 08:00–12:50
  const post = spread(27.5, '13:00', 20, 9); // 13:00–15:51

  it('finds the step, its size and the level since', () => {
    const r = detectRise([...pre, ...post], now)!;
    expect(r).not.toBeNull();
    expect(Date.parse(r.at)).toBe(at('13:00'));
    expect(r.before).toBeCloseTo(25.1, 1);
    expect(r.after).toBeCloseTo(27.6, 1);
    expect(r.now).toBeCloseTo(27.6, 1);
  });

  it('stays detected in a quiet evening (no new reports for hours, F22)', () => {
    expect(detectRise([...pre, ...post], Date.parse('2026-10-24T21:30:00Z'))).not.toBeNull();
  });

  it('flat market, thin data or a rise older than 24 h → null', () => {
    expect(detectRise(spread(25, '08:00', 50, 10), now)).toBeNull();
    expect(detectRise([...pre.slice(-7), ...post.slice(0, 7)], now)).toBeNull();
    expect(detectRise([...pre, ...post], Date.parse('2026-10-25T16:00:00Z'))).toBeNull();
  });

  it('a falling market is not a rise', () => {
    expect(detectRise([...spread(27.5, '08:00', 30, 10), ...spread(25, '13:00', 20, 9)], now)).toBeNull();
  });
});

describe('isOutdated', () => {
  const rise = { at: '2026-10-24T13:00:00.000Z', before: 25, after: 27.5, now: 27.4 };
  it('before the rise and ≥ 1 kr below the market since → outdated', () => {
    expect(isOutdated({ price: 25.1, t: at('10:38') }, rise)).toBe(true); // the Kiellands Plass case
    expect(isOutdated({ price: 27.0, t: at('10:38') }, rise)).toBe(false); // already in line
    expect(isOutdated({ price: 23.0, t: at('14:00') }, rise)).toBe(false); // after the rise: a bargain, not outdated
    expect(isOutdated({ price: 20, t: at('10:00') }, null)).toBe(false);
  });
  it('once prices ease back (now ≈ before), pre-rise prices stop being outdated', () => {
    expect(isOutdated({ price: 25.1, t: at('10:38') }, { ...rise, now: 25.6 })).toBe(false);
  });
});
