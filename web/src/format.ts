// Display helpers. Prices are NOK/L with two decimals; every number renders in Geist Mono (.num).

export const price2 = (n: number): string => n.toFixed(2);

export function age(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 6 && m >= 5) return `${h} h ${m} min ago`;
  return `${h} h ago`;
}

export const km = (d: number): string => (d < 10 ? d.toFixed(1) : Math.round(d).toString()) + ' km';

export type Tone = 'cheap' | 'pricey' | 'neutral';

/** Δ vs the reference price (shown to users as "Oslo average") → tone, arrow and a text label (colour is never the only signal). */
export function delta(p: number, ref: number | null): { tone: Tone; arrow: string; text: string } | null {
  if (ref === null) return null;
  const d = Math.round((p - ref) * 100) / 100;
  if (d <= -0.01) return { tone: 'cheap', arrow: '▼', text: `${price2(-d)} below Oslo average` };
  if (d >= 0.01) return { tone: 'pricey', arrow: '▲', text: `${price2(d)} above Oslo average` };
  return { tone: 'neutral', arrow: '=', text: 'at Oslo average' };
}

export function saving(n: number | null): { text: string; tone: Tone } | null {
  if (n === null) return null;
  if (n > 0) return { text: `Save ~${n} kr`, tone: 'cheap' };
  if (n < 0) return { text: `~${-n} kr dearer`, tone: 'pricey' };
  return { text: 'Break-even', tone: 'neutral' };
}

export const navUrl = (lat: number, lon: number): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}`;

/** Today's Europe/Oslo date, 'YYYY-MM-DD'. */
export const osloToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const toneClass: Record<Tone, string> = { cheap: 'text-cheap', pricey: 'text-pricey', neutral: 'text-muted' };

/** Drop the brand when the station name already contains it ("Circle K Kalbakken" + "Circle K"). */
export const extraBrand = (name: string, brand: string): string =>
  brand && !name.toLowerCase().includes(brand.toLowerCase()) ? brand : '';
