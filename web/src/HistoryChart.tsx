// 30-day price history on one shared, dated time axis:
// 1. Pump prices per day, split at the daily rise: a bar for the middle 50 % of stations (p25–p75) and a dot
//    for the median, morning (06–12, before the rise) and afternoon/evening (15–24, after it). One whole-day
//    bar would blend the two levels into a "median" no pump ever showed.
// 2. The official wholesale cost (before tax and margin), which has full history from day one.
// Every day keeps its slot; days before Pumpevakt started recording are shaded, not stretched over.
import { useState } from 'react';
import { type Fuel, FUEL_LABELS, type OutlookResponse } from './api';
import { osloToday, price2 } from './format';

const DAYS = 30;
const RECORDING_SINCE = '2026-10-23'; // first prices run in production
const W = 340;
const L = 36; // left gutter for y labels
const R = 8;
const AM = '#3b7dd8';
const PM = 'var(--pricey)';

type Spread = OutlookResponse['spread'][number];
type Q = NonNullable<Spread['am']>;

const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });

/** The last DAYS Oslo dates, oldest first, ending today. */
function slots(): string[] {
  const end = Date.parse(`${osloToday()}T12:00:00Z`);
  return Array.from({ length: DAYS }, (_, i) => new Date(end - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** ~n "nice" tick values (steps of 1, 2, 2.5 or 5 × 10^k) covering [lo, hi]. */
function niceTicks(lo: number, hi: number, n: number): number[] {
  const raw = (hi - lo) / n;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const x = (i: number) => L + ((i + 0.5) * (W - L - R)) / DAYS;
const SLOT = (W - L - R) / DAYS;

export function HistoryChart({ outlook, fuel }: { outlook: OutlookResponse | null; fuel: Fuel }) {
  const days = slots();
  const [picked, setPicked] = useState<string | null>(null);
  if (!outlook || outlook.fuel !== fuel) return null;

  const byDay = new Map(outlook.spread.map((s) => [s.day, s]));
  const wdi = fuel === 'diesel' ? outlook.wdi.filter((w) => w.day >= days[0]!) : [];
  const latestDay = outlook.spread.at(-1)?.day ?? days.at(-1)!;
  const sel = picked ?? latestDay;
  const selSpread = byDay.get(sel);
  const selWdi = [...wdi].reverse().find((w) => w.day <= sel);
  const today = osloToday();

  return (
    <section aria-labelledby="hist-h" className="rounded-xl border border-line bg-surface p-3">
      <h2 id="hist-h" className="text-sm font-semibold">
        {FUEL_LABELS[fuel]} · last 30 days
      </h2>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
        <span>
          <Swatch color={AM} /> Morning 06–12, before the daily rise
        </span>
        <span>
          <Swatch color={PM} /> Afternoon 15–24, after it
        </span>
        <span>bar = middle 50 % of stations · dot = median</span>
      </p>

      <PumpChart days={days} byDay={byDay} sel={sel} onPick={setPicked} />
      {wdi.length >= 2 && <WholesaleChart days={days} wdi={wdi} sel={sel} onPick={setPicked} />}

      <div className="mt-2 rounded-lg bg-bg px-2.5 py-2 text-xs" aria-live="polite">
        <p className="font-medium">
          {fmtDay(sel, { weekday: 'short', day: 'numeric', month: 'short' })}
          {sel === today ? ' (so far)' : ''}
        </p>
        {selSpread?.am || selSpread?.pm ? (
          <>
            {selSpread.am && <QLine label="Morning" color={AM} q={selSpread.am} />}
            {selSpread.pm && <QLine label="Afternoon" color={PM} q={selSpread.pm} />}
          </>
        ) : (
          <p className="text-muted">{sel < RECORDING_SINCE ? 'Before Pumpevakt started recording.' : 'Too few stations reported (needs 10 per window).'}</p>
        )}
        {selWdi && (
          <p className="text-muted">
            Wholesale <span className="num text-ink">{price2(selWdi.value)}</span> kr/L
            {selWdi.day !== sel ? ` (latest published, ${fmtDay(selWdi.day, { day: 'numeric', month: 'short' })})` : ''}
          </p>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        Tap a day for its numbers. Pump history starts {fmtDay(RECORDING_SINCE, { day: 'numeric', month: 'short' })}, when Pumpevakt began
        recording; earlier days are shaded.
      </p>
    </section>
  );
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" className="mr-0.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: color }} />;
}

function QLine({ label, color, q }: { label: string; color: string; q: Q }) {
  return (
    <p>
      <Swatch color={color} /> {label}: median <span className="num font-semibold">{price2(q.p50)}</span>{' '}
      <span className="whitespace-nowrap text-muted">
        (middle 50 % <span className="num">{price2(q.p25)}</span>–<span className="num">{price2(q.p75)}</span>)
      </span>
    </p>
  );
}

/** Weekly date ticks (counted back from today) and the shared tap targets / selection column. */
function XAxis({ days, top, bottom, sel, onPick, labels }: { days: string[]; top: number; bottom: number; sel: string; onPick: (d: string) => void; labels: boolean }) {
  const selI = days.indexOf(sel);
  return (
    <g>
      {selI >= 0 && <rect x={x(selI) - SLOT / 2} y={top} width={SLOT} height={bottom - top} fill="color-mix(in srgb, var(--ink) 8%, transparent)" />}
      {days.map((d, i) =>
        (DAYS - 1 - i) % 7 === 0 ? (
          <g key={d}>
            <line x1={x(i)} x2={x(i)} y1={top} y2={bottom} stroke="var(--line)" strokeDasharray="2 3" />
            {labels && (
              <text x={x(i)} y={bottom + 11} fontSize={9} textAnchor={i === DAYS - 1 ? 'end' : 'middle'} fill="var(--ink-muted)">
                {i === DAYS - 1 ? 'today' : fmtDay(d, { day: 'numeric', month: 'short' })}
              </text>
            )}
          </g>
        ) : null,
      )}
      {days.map((d, i) => (
        <rect key={`hit-${d}`} x={x(i) - SLOT / 2} y={top} width={SLOT} height={bottom - top} fill="transparent" style={{ cursor: 'pointer' }} onClick={() => onPick(d)}>
          <title>{fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' })}</title>
        </rect>
      ))}
    </g>
  );
}

function YGrid({ ticks, y, digits }: { ticks: number[]; y: (v: number) => number; digits: number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={L - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--ink-muted)">
            {t.toFixed(digits)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Days before RECORDING_SINCE: hatched, with a label when wide enough. */
function NotRecorded({ days, top, bottom }: { days: string[]; top: number; bottom: number }) {
  const n = days.filter((d) => d < RECORDING_SINCE).length;
  if (n === 0) return null;
  const w = n * SLOT;
  return (
    <g>
      <defs>
        <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="var(--line)" strokeWidth="2" />
        </pattern>
      </defs>
      <rect x={L} y={top} width={w} height={bottom - top} fill="url(#hatch)" opacity={0.7} />
      {w > 90 && (
        <text x={L + w / 2} y={(top + bottom) / 2 + 3} textAnchor="middle" fontSize={10} fill="var(--ink-muted)">
          not recorded yet
        </text>
      )}
    </g>
  );
}

function PumpChart({ days, byDay, sel, onPick }: { days: string[]; byDay: Map<string, Spread>; sel: string; onPick: (d: string) => void }) {
  const H = 150;
  const T = 6;
  const B = H - 16;
  const qs = [...byDay.values()].flatMap((s) => [s.am, s.pm].filter((q): q is Q => !!q));
  if (qs.length === 0) {
    return <p className="mt-2 text-sm text-muted">No daily pump history yet: a window needs at least 10 stations reporting.</p>;
  }
  let lo = Math.min(...qs.map((q) => q.p25));
  let hi = Math.max(...qs.map((q) => q.p75));
  const pad = Math.max(0.3, (2 - (hi - lo)) / 2); // at least a 2 kr window so one day isn't blown up
  lo -= pad;
  hi += pad;
  const y = (v: number) => T + ((hi - v) * (B - T)) / (hi - lo);
  const bw = Math.max(2.5, SLOT * 0.36);
  const series = (w: 'am' | 'pm') => {
    // Median line only across consecutive days that have this window.
    const segs: string[][] = [[]];
    days.forEach((d, i) => {
      const q = byDay.get(d)?.[w];
      if (!q) return void (segs.at(-1)!.length && segs.push([]));
      segs.at(-1)!.push(`${(x(i) + (w === 'am' ? -bw / 2 - 0.5 : bw / 2 + 0.5)).toFixed(1)},${y(q.p50).toFixed(1)}`);
    });
    return segs.filter((s) => s.length > 1);
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full select-none" role="img" aria-label="Daily pump price range, morning and afternoon, last 30 days">
      <NotRecorded days={days} top={T} bottom={B} />
      <YGrid ticks={niceTicks(lo, hi, 4)} y={y} digits={0} />
      <XAxis days={days} top={T} bottom={B} sel={sel} onPick={onPick} labels />
      {(['am', 'pm'] as const).map((w) =>
        series(w).map((s, i) => <polyline key={`${w}${i}`} points={s.join(' ')} fill="none" stroke={w === 'am' ? AM : PM} strokeWidth={1} opacity={0.6} pointerEvents="none" />),
      )}
      {days.map((d, i) => {
        const s = byDay.get(d);
        if (!s) return null;
        return (['am', 'pm'] as const).map((w) => {
          const q = s[w];
          if (!q) return null;
          const cx = x(i) + (w === 'am' ? -bw / 2 - 0.5 : bw / 2 + 0.5);
          const c = w === 'am' ? AM : PM;
          return (
            <g key={`${d}${w}`} pointerEvents="none">
              <rect x={cx - bw / 2} y={y(q.p75)} width={bw} height={Math.max(1.5, y(q.p25) - y(q.p75))} rx={1} fill={`color-mix(in srgb, ${c} 35%, transparent)`} />
              <circle cx={cx} cy={y(q.p50)} r={d === sel ? 3 : 2.2} fill={c} stroke="var(--surface)" strokeWidth={0.8} />
            </g>
          );
        });
      })}
    </svg>
  );
}

function WholesaleChart({ days, wdi, sel, onPick }: { days: string[]; wdi: OutlookResponse['wdi']; sel: string; onPick: (d: string) => void }) {
  const H = 96;
  const T = 8;
  const B = H - 16;
  const pts = wdi.map((w) => ({ i: days.indexOf(w.day), v: w.value, day: w.day })).filter((p) => p.i >= 0);
  if (pts.length < 2) return null;
  const vlo = Math.min(...pts.map((p) => p.v));
  const vhi = Math.max(...pts.map((p) => p.v));
  const pad = Math.max(0.1, (vhi - vlo) * 0.15);
  const lo = vlo - pad;
  const hi = vhi + pad;
  const y = (v: number) => T + ((hi - v) * (B - T)) / (hi - lo);
  const first = pts[0]!;
  const last = pts.at(-1)!;
  const change = Math.round((last.v - first.v) * 100) / 100;
  const line = pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${x(first.i).toFixed(1)},${B} ${line} ${x(last.i).toFixed(1)},${B}`;
  const gap = DAYS - 1 - last.i; // days after the latest published value

  return (
    <figure className="mt-3 border-t border-line pt-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
        <span className="font-medium">Wholesale diesel cost</span>
        <span>
          <span className="num font-semibold">{price2(last.v)}</span> kr/L{' '}
          <span className={`num ${change < 0 ? 'text-cheap' : change > 0 ? 'text-pricey' : 'text-muted'}`}>
            {change < 0 ? '▼' : change > 0 ? '▲' : '='}
            {price2(Math.abs(change))}
          </span>{' '}
          <span className="text-muted">since {fmtDay(first.day, { day: 'numeric', month: 'short' })}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full select-none" role="img" aria-label={`Wholesale diesel cost, ${price2(last.v)} kroner per litre on ${last.day}`}>
        <YGrid ticks={niceTicks(lo, hi, 3)} y={y} digits={niceTicks(lo, hi, 3).some((t) => t % 1) ? 1 : 0} />
        <XAxis days={days} top={T} bottom={B} sel={sel} onPick={onPick} labels />
        {gap >= 2 && (
          <g pointerEvents="none">
            <rect x={x(last.i) + SLOT / 2} y={T} width={gap * SLOT} height={B - T} fill="color-mix(in srgb, var(--ink) 4%, transparent)" />
            {gap * SLOT > 40 && (
              <text x={x(last.i) + SLOT / 2 + (gap * SLOT) / 2} y={T + 10} textAnchor="middle" fontSize={8.5} fill="var(--ink-muted)">
                not published yet
              </text>
            )}
          </g>
        )}
        <polygon points={area} fill="color-mix(in srgb, var(--ink) 7%, transparent)" pointerEvents="none" />
        <polyline points={line} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinejoin="round" pointerEvents="none" />
        {pts.map((p) => (
          <circle key={p.day} cx={x(p.i)} cy={y(p.v)} r={p.day === sel ? 3 : 1.6} fill="var(--ink)" pointerEvents="none" />
        ))}
        <text x={x(last.i) - 4} y={y(last.v) - 6} textAnchor="end" fontSize={9} fontWeight={600} fill="var(--ink)" pointerEvents="none">
          {price2(last.v)}
        </text>
      </svg>
      <p className="text-[11px] text-muted">
        Product cost before tax and margin: NY Harbor diesel (FRED) × USD/NOK (Norges Bank), published on trading days with a few
        days’ delay. Monthly Oslo pump prices tracked it closely in our backtest (r = 0.92).
      </p>
    </figure>
  );
}
