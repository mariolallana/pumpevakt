// QA black-box tests for the net-saving formula (docs/04 §3, docs/web-v1-contract.md "Pure logic").
//   detour_km  = 2 × straight_line_km × 1.3
//   net_saving = (L − price) × TANK_L − detour_km × CONSUMPTION_L100 / 100 × price
// Expected values are computed by hand below (not with the implementation's code).
// The contract signature is netSavingNok(refPrice, price, distanceKm, tankL, consumptionL100): number.
// The API rounds to an integer; the function may or may not round, so most checks compare Math.round(...).
import { describe, it, expect } from 'vitest';
import { netSavingNok } from '../../src/core/netSaving';

const r = (x: number) => Math.round(x);

describe('QA-NS net saving (docs/04 §3)', () => {
  it('QA-NS-01 hand example: L 24.00, price 23.00, 2 km, tank 50, 6.5 L/100 → 42 kr', () => {
    // gain 1.00 × 50 = 50; detour 2×2×1.3 = 5.2 km; fuel 5.2 × 0.065 = 0.338 L; cost 0.338 × 23 = 7.774 → 42.226
    expect(r(netSavingNok(24, 23, 2, 50, 6.5))).toBe(42);
    expect(netSavingNok(24, 23, 2, 50, 6.5)).toBeCloseTo(42.226, 0);
  });

  it('QA-NS-02 hand example: zero distance, same price → 0', () => {
    expect(r(netSavingNok(24, 24, 0, 50, 6.5))).toBe(0);
  });

  it('QA-NS-03 hand example: pricier than L gives a negative saving: L 23, price 24, 1 km → −54', () => {
    // −1 × 50 = −50; detour 2.6 km → 0.169 L × 24 = 4.056 → −54.056
    expect(r(netSavingNok(23, 24, 1, 50, 6.5))).toBe(-54);
  });

  it('QA-NS-04 hand example: cheaper but far away: L 24.00, price 23.50, 15 km → −35', () => {
    // gain 0.5 × 50 = 25; detour 39 km → 2.535 L × 23.5 = 59.5725 → −34.57 → −35
    expect(r(netSavingNok(24, 23.5, 15, 50, 6.5))).toBe(-35);
  });

  it('QA-NS-05 detour multiplier is 2 × km × 1.3 (not 1×, not 2× without the 1.3 factor)', () => {
    // with zero price difference the result is −(2×d×1.3)×c/100×p exactly
    const v = netSavingNok(20, 20, 10, 50, 10); // detour 26 km → 2.6 L × 20 = 52
    expect(v).toBeCloseTo(-52, 0);
    expect(r(v)).not.toBe(-20); // 1 × km
    expect(r(v)).not.toBe(-40); // 2 × km, no 1.3
  });

  it('QA-NS-06 tank size and consumption are parameters (config), not hard-coded', () => {
    // tank 60, 8 L/100: gain 1 × 60 = 60; detour 5.2 km → 0.416 L × 23 = 9.568 → 50.43 → 50
    expect(r(netSavingNok(24, 23, 2, 60, 8))).toBe(50);
    // tank 40, 5 L/100: gain 40; detour 5.2 → 0.26 L × 23 = 5.98 → 34.02 → 34
    expect(r(netSavingNok(24, 23, 2, 40, 5))).toBe(34);
  });

  it('QA-NS-07 realistic Oslo example (docs/06 /near style): L 22.56, Uno-X 20.89 at 1.8 km → 77', () => {
    // gain 1.67 × 50 = 83.5; detour 4.68 km → 0.3042 L × 20.89 = 6.3547 → 77.145
    expect(r(netSavingNok(22.56, 20.89, 1.8, 50, 6.5))).toBe(77);
  });

  it('QA-NS-08 detour fuel is costed at the station price, not at L', () => {
    // L 30, price 20, 10 km, tank 0 → −(26 km × 0.1 L/km) × 20 = −52 (would be −78 at L)
    expect(netSavingNok(30, 20, 10, 0, 10)).toBeCloseTo(-52, 0);
  });

  it('QA-NS-09 monotonic: farther is never better, cheaper is never worse', () => {
    expect(netSavingNok(24, 23, 1, 50, 6.5)).toBeGreaterThan(netSavingNok(24, 23, 5, 50, 6.5));
    expect(netSavingNok(24, 22.5, 3, 50, 6.5)).toBeGreaterThan(netSavingNok(24, 23, 3, 50, 6.5));
  });

  it('QA-NS-10 returns a finite number for normal inputs', () => {
    expect(Number.isFinite(netSavingNok(24.12, 23.45, 3.21, 50, 6.5))).toBe(true);
  });
});
