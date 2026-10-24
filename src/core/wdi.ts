// Wholesale Diesel Index (docs/01 §3): WDI (NOK/L) = ULSD (USD/gal) ÷ 3.78541 × USD/NOK.
import type { MarketPoint } from '../types';

export const LITRES_PER_US_GALLON = 3.78541;
export const WDI_SERIES = 'wdi_nok_l';

/**
 * One WDI point per ULSD day, using USD/NOK of that day or the latest earlier day.
 * ULSD days before the first USD/NOK observation are skipped. Output sorted by day.
 */
export function computeWdi(ulsd: MarketPoint[], usdnok: MarketPoint[]): MarketPoint[] {
  const fx = [...usdnok].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const days = [...ulsd].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const out: MarketPoint[] = [];
  let i = -1;
  for (const u of days) {
    while (i + 1 < fx.length && fx[i + 1]!.day <= u.day) i++;
    if (i < 0) continue;
    out.push({ day: u.day, series: WDI_SERIES, value: (u.value / LITRES_PER_US_GALLON) * fx[i]!.value });
  }
  return out;
}
