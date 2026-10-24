// Norges Bank open SDMX adapter (docs/01 §1): USD/NOK spot, business days.
import { FETCH_TIMEOUT_MS, USER_AGENT, type MarketPoint } from '../types';
import { csvLines, DAY_RE, num, unquote } from './csv';

export const NORGES_BANK_URL =
  'https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=csv&lastNObservations=60&locale=en';
export const USDNOK_SERIES = 'usdnok';

/**
 * Parse the ';'-separated CSV. Uses the TIME_PERIOD / OBS_VALUE columns from the header,
 * falling back to the last two columns. Series 'usdnok'.
 */
export function parseNorgesBankCsv(csv: string): MarketPoint[] {
  const lines = csvLines(csv);
  if (lines.length === 0) return [];
  const header = lines[0]!.split(';').map(unquote);
  const iDay = header.indexOf('TIME_PERIOD');
  const iVal = header.indexOf('OBS_VALUE');
  const out: MarketPoint[] = [];
  for (const line of lines) {
    const cells = line.split(';');
    const dIdx = iDay >= 0 ? iDay : cells.length - 2;
    const vIdx = iVal >= 0 ? iVal : cells.length - 1;
    const day = unquote(cells[dIdx]);
    if (!DAY_RE.test(day)) continue; // header or junk
    const value = num(cells[vIdx]);
    if (value === null) continue;
    out.push({ day, series: USDNOK_SERIES, value });
  }
  return out;
}

export async function fetchUsdNok(fetchFn: typeof fetch = fetch): Promise<MarketPoint[]> {
  const res = await fetchFn(NORGES_BANK_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Norges Bank HTTP ${res.status}`);
  return parseNorgesBankCsv(await res.text());
}
