import { describe, expect, it } from 'vitest';
import { osloDate, osloHour } from '../../src/core/time';

describe('osloDate / osloHour (cached per UTC hour)', () => {
  it('CEST (UTC+2), CET (UTC+1) and both DST switches', () => {
    expect([osloDate(new Date('2026-10-24T21:59:59Z')), osloHour(new Date('2026-10-24T21:59:59Z'))]).toEqual(['2026-10-24', 23]);
    expect([osloDate(new Date('2026-10-24T22:00:00Z')), osloHour(new Date('2026-10-24T22:00:00Z'))]).toEqual(['2026-10-25', 0]);
    // 2026-10-25 01:00 UTC: clocks go back 03:00 → 02:00
    expect(osloHour(new Date('2026-10-25T00:30:00Z'))).toBe(2);
    expect(osloHour(new Date('2026-10-25T01:30:00Z'))).toBe(2);
    expect(osloHour(new Date('2026-10-25T02:30:00Z'))).toBe(3);
    // 2026-03-29 01:00 UTC: clocks go forward 02:00 → 03:00
    expect(osloHour(new Date('2026-03-29T00:59:00Z'))).toBe(1);
    expect(osloHour(new Date('2026-03-29T01:00:00Z'))).toBe(3);
    expect(osloDate(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });

  it('same answers on repeated (cached) calls', () => {
    const d = new Date('2026-10-24T13:37:00Z');
    expect([osloDate(d), osloHour(d)]).toEqual(['2026-10-24', 15]);
    expect([osloDate(d), osloHour(d)]).toEqual(['2026-10-24', 15]);
  });
});
