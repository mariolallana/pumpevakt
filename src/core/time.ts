// Pure time helpers. All stored timestamps are ISO-8601 UTC; "days" for Oslo series are Europe/Oslo dates.
//
// Intl formatting is slow in Workers (~5 µs a call), and chain levels convert hundreds of reports per
// request. Europe/Oslo's UTC offset is always a whole number of hours, so the Oslo date and hour depend
// only on the UTC hour: convert once per UTC hour and cache (2026-10-24: /api/outlook 7–22 ms → ~2 ms CPU).

const osloFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Oslo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

const HOUR_MS = 3_600_000;
const cache = new Map<number, { date: string; hour: number }>();

function osloParts(d: Date): { date: string; hour: number } {
  const key = Math.floor(d.getTime() / HOUR_MS);
  let v = cache.get(key);
  if (!v) {
    const parts = osloFmt.formatToParts(new Date(key * HOUR_MS));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    v = { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
    if (cache.size > 10_000) cache.clear();
    cache.set(key, v);
  }
  return v;
}

/** Europe/Oslo calendar date of an instant, 'YYYY-MM-DD'. */
export function osloDate(d: Date): string {
  return osloParts(d).date;
}

/** Europe/Oslo hour of an instant, 0–23. */
export function osloHour(d: Date): number {
  return osloParts(d).hour;
}
