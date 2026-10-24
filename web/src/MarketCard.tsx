// Oslo median card, compact (one line) so the best deal is above the fold on a phone (contract scope 3):
// level now ("Oslo average"), today's median and the wholesale (WDI) trend when available.
import type { MarketResponse } from './api';
import { age, osloToday, price2 } from './format';

export function MarketCard({ market, loading }: { market: MarketResponse | null; loading: boolean }) {
  if (loading && !market) {
    return (
      <section aria-label="Oslo diesel average" aria-busy="true" className="rounded-xl border border-line bg-surface px-2.5 py-2.5">
        <div className="skeleton h-5 w-64" />
      </section>
    );
  }
  if (!market) return null;

  const level = market.latest.level;
  const today = market.osloDieselMedian.at(-1);
  const todayMedian = today && today.day === osloToday() ? today.value : null;
  const levelAge = market.latest.at ? Math.max(0, Math.floor((Date.now() - Date.parse(market.latest.at)) / 60_000)) : null;

  const wdi = market.wdi;
  const wLast = wdi.at(-1);
  const wPrev = wdi.length >= 6 ? wdi[wdi.length - 6] : wdi[0];
  const wChange = wLast && wPrev && wPrev !== wLast ? Math.round((wLast.value - wPrev.value) * 100) / 100 : null;
  const wText =
    wChange === null ? null : wChange === 0 ? 'flat' : `${wChange < 0 ? '▼' : '▲'}${price2(Math.abs(wChange))} ${wChange < 0 ? 'down' : 'up'}`;

  const summary =
    `Oslo diesel average ${level !== null ? `${price2(level)} kroner per litre` : 'not available'}` +
    (levelAge !== null ? `, updated ${age(levelAge)}` : '') +
    (todayMedian !== null ? `. Today's median ${price2(todayMedian)}` : '') +
    (wLast ? `. Wholesale cost ${price2(wLast.value)} kroner per litre${wText ? `, ${wText} since ${wPrev!.day}` : ''}` : '') +
    '.';

  return (
    <section aria-label={summary} className="rounded-xl border border-line bg-surface px-2.5 py-2.5">
      <p aria-hidden="true" className="flex items-baseline gap-x-2 overflow-hidden whitespace-nowrap text-xs text-muted">
        <span title={levelAge !== null ? `Updated ${age(levelAge)}` : undefined}>
          Oslo average{' '}
          <span className="num text-base font-semibold text-ink">{level !== null ? price2(level) : '–'}</span>
        </span>
        {todayMedian !== null && (
          <span>
            today <span className="num text-ink">{price2(todayMedian)}</span>
          </span>
        )}
        {wText && (
          <span title={`Wholesale cost ${price2(wLast!.value)} kr/L, ${wText} since ${wPrev!.day}`}>
            wholesale{' '}
            <span className={`num ${wChange! < 0 ? 'text-cheap' : wChange! > 0 ? 'text-pricey' : 'text-ink'}`}>{wText.split(' ')[0]}</span>
          </span>
        )}
        {levelAge !== null && <span className="num">{age(levelAge)}</span>}
      </p>
    </section>
  );
}
