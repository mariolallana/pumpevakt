// Net saving of filling up at a station vs the reference price (docs/04 §3).
//
//   detour_km  = 2 × straight_line_km × 1.3
//   net_saving = (L − price) × TANK_L − detour_km × CONSUMPTION_L100 / 100 × price
//
// "save ~62 kr *if you go there just to fill up*". Rounded to whole NOK.

export const DETOUR_FACTOR = 1.3;

/** Net saving in NOK (integer, may be negative). `distanceKm` is the straight-line distance one way. */
export function netSavingNok(refPrice: number, price: number, distanceKm: number, tankL: number, consumptionL100: number): number {
  const detourKm = 2 * distanceKm * DETOUR_FACTOR;
  const raw = (refPrice - price) * tankL - (detourKm * consumptionL100) / 100 * price;
  return Math.round(raw) + 0; // `+ 0` turns -0 into 0
}
