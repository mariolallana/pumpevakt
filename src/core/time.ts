// Pure time helpers. All stored timestamps are ISO-8601 UTC; "days" for Oslo series are Europe/Oslo dates.

const osloFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Oslo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Europe/Oslo calendar date of an instant, 'YYYY-MM-DD'. */
export function osloDate(d: Date): string {
  const parts = osloFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
