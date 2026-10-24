// FRED keyless CSV adapter (docs/01 §1), e.g. DDFUELNYH = NY Harbor ULSD, USD/gal, daily.
import { FETCH_TIMEOUT_MS, USER_AGENT, type MarketPoint } from '../types';
import { csvLines, DAY_RE, num, unquote } from './csv';

export const FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
export const LOOKBACK_DAYS = 60;

/** Parse `observation_date,<ID>` CSV. Skips the header, '.' (FRED's missing value), blanks and malformed rows. */
export function parseFredCsv(csv: string, series: string): MarketPoint[] {
  const out: MarketPoint[] = [];
  for (const line of csvLines(csv)) {
    const [d, v] = line.split(',');
    const day = unquote(d);
    if (!DAY_RE.test(day)) continue; // header or junk
    const value = num(v);
    if (value === null) continue;
    out.push({ day, series, value });
  }
  return out;
}

/** Fetch the last ~60 days of a FRED series (`cosd` = start date, defaults to today − 60 days). */
export async function fetchFred(
  seriesId: string,
  series: string,
  fetchFn: typeof fetch = fetch,
  opts: { now?: Date } = {},
): Promise<MarketPoint[]> {
  const cosd = new Date((opts.now ?? new Date()).getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const url = `${FRED_URL}?id=${encodeURIComponent(seriesId)}&cosd=${cosd}`;
  const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  return parseFredCsv(await res.text(), series);
}
