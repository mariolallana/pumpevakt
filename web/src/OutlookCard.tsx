// "Fill up now or wait?" — the headline (docs/spec-flaws.md F23): timing first, stations second.
// Facts (the rise, the morning levels) are shown apart from the advice, and every claim names its basis.
import { CHAIN_LABELS, type ChainGroup, type Fuel, FUEL_LABELS, type OutlookResponse } from './api';
import { price2 } from './format';

const CHAIN_ORDER: ChainGroup[] = ['circlek', 'unox', 'esso', 'st1', 'other'];
const LINE: Record<ChainGroup, string> = {
  all: 'var(--ink)',
  circlek: '#d9381e',
  unox: '#1f6fd1',
  esso: '#7a4bc2',
  st1: '#d4a017',
  other: 'var(--ink-muted)',
};

const osloTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const osloDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' }).format(new Date(iso));
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });

/** "around 15:00 today" (the rise time is only known to ~30 min, so round to the hour). */
function whenText(iso: string): string {
  const d = new Date(Math.round(Date.parse(iso) / 3_600_000) * 3_600_000);
  const today = osloDay(new Date().toISOString());
  return `around ${osloTime(d.toISOString())} ${osloDay(d.toISOString()) === today ? 'today' : 'yesterday'}`;
}

const TONE = {
  wait: { icon: '⏳', title: 'Wait if you can', cls: 'border-pricey' },
  good: { icon: '✅', title: 'Good time to fill up', cls: 'border-cheap' },
  normal: { icon: '•', title: 'No price rise in the last 24 h', cls: 'border-line' },
  unknown: { icon: '?', title: 'Not enough current prices to judge', cls: 'border-line' },
} as const;

export function OutlookCard({ outlook, loading, fuel }: { outlook: OutlookResponse | null; loading: boolean; fuel: Fuel }) {
  if (loading && !outlook) {
    return (
      <section aria-busy="true" className="rounded-xl border border-line bg-surface p-3">
        <div className="skeleton h-5 w-48" />
        <div className="skeleton mt-2 h-4 w-64" />
      </section>
    );
  }
  if (!outlook || outlook.fuel !== fuel) return null;

  const { verdict, rise, level, norm, history } = outlook;
  const tone = TONE[verdict];
  const risen = rise ? Math.round(((rise.now ?? rise.after) - rise.before) * 100) / 100 : null;
  const latest = history.at(-1);
  const chains = latest
    ? CHAIN_ORDER.filter((g) => latest.levels[g] !== undefined).sort((a, b) => latest.levels[a]! - latest.levels[b]!)
    : [];

  return (
    <section aria-labelledby="outlook-h" className={`rounded-xl border-2 ${tone.cls} bg-surface p-3`}>
      <p className="text-xs text-muted">{FUEL_LABELS[fuel]} · Oslo · fill up now?</p>
      <h2 id="outlook-h" className="mt-0.5 text-lg font-semibold">
        <span aria-hidden="true">{tone.icon}</span> {tone.title}
      </h2>

      {/* Facts */}
      <p className="mt-1 text-sm">
        {rise && verdict === 'wait' && (
          <>
            Prices rose <span className="num font-medium">{price2(rise.after - rise.before)} kr</span> {whenText(rise.at)} (
            <span className="num">{price2(rise.before)}</span> → <span className="num">{price2(rise.now ?? rise.after)}</span>) and are still{' '}
            <span className="num">{price2(risen!)}</span> kr up.
          </>
        )}
        {rise && verdict === 'good' && (
          <>
            After the rise {whenText(rise.at)}, prices are back near the pre-rise level (
            <span className="num">{price2(rise.now ?? rise.after)}</span> vs <span className="num">{price2(rise.before)}</span>).
          </>
        )}
        {!rise && level !== null && (
          <>
            Oslo average now <span className="num font-medium">{price2(level)}</span>.
          </>
        )}
      </p>
      {/* Advice, kept apart from the facts */}
      {verdict === 'wait' && (
        <p className="mt-1 text-xs text-muted">Norwegian pump prices usually drift back down before the next daily rise.</p>
      )}

      {/* Day-to-day: morning level vs normal (the market-drop signal) */}
      {norm.level !== null && (
        <p className="mt-2 text-xs text-muted">
          Morning level {norm.day === osloDay(new Date().toISOString()) ? 'today' : shortDay(norm.day!)}{' '}
          <span className="num text-ink">{price2(norm.level)}</span>
          {norm.delta !== null ? (
            <>
              {' '}
              ·{' '}
              <span className={`num ${norm.delta <= -0.5 ? 'text-cheap' : norm.delta >= 0.5 ? 'text-pricey' : 'text-ink'}`}>
                {norm.delta < 0 ? '▼' : norm.delta > 0 ? '▲' : '='}
                {price2(Math.abs(norm.delta))}
              </span>{' '}
              vs the {norm.nDays}-day normal
            </>
          ) : (
            <> · learning what’s normal ({norm.nDays}/5 days)</>
          )}
        </p>
      )}

      {chains.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-muted">Chains, morning price (06–12) {latest!.day === osloDay(new Date().toISOString()) ? 'today' : shortDay(latest!.day)}</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Morning price per chain, cheapest first">
            {chains.map((g, i) => (
              <li key={g} className="flex items-center gap-1">
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: LINE[g] }} />
                {CHAIN_LABELS[g]} <span className={`num ${i === 0 ? 'font-semibold text-cheap' : ''}`}>{price2(latest!.levels[g]!)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length >= 2 && <Trend history={history} />}
    </section>
  );
}

/** Morning level per chain over time: one thin line per chain, Oslo-wide in bold. Inline SVG, no chart library. */
function Trend({ history }: { history: OutlookResponse['history'] }) {
  const W = 320;
  const H = 90;
  const P = 4;
  const groups: ChainGroup[] = ['all', ...CHAIN_ORDER];
  const vals = history.flatMap((h) => groups.map((g) => h.levels[g]).filter((v): v is number => v !== undefined));
  const lo = Math.min(...vals) - 0.2;
  const hi = Math.max(...vals) + 0.2;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, history.length - 1);
  const y = (v: number) => P + ((hi - v) * (H - 2 * P)) / (hi - lo);
  const path = (g: ChainGroup) =>
    history
      .map((h, i) => (h.levels[g] === undefined ? null : `${x(i).toFixed(1)},${y(h.levels[g]!).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label={`Morning price per chain over the last ${history.length} days`}>
        {groups.map((g) => (
          <polyline key={g} points={path(g)} fill="none" stroke={LINE[g]} strokeWidth={g === 'all' ? 2.5 : 1.25} strokeLinejoin="round" />
        ))}
      </svg>
      <figcaption className="flex justify-between text-[11px] text-muted">
        <span className="num">{shortDay(history[0]!.day)}</span>
        <span>
          <span className="num">{price2(lo + 0.2)}</span>–<span className="num">{price2(hi - 0.2)}</span> kr
        </span>
        <span className="num">{shortDay(history.at(-1)!.day)}</span>
      </figcaption>
    </figure>
  );
}
