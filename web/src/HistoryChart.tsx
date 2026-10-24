// 30-day price history: per day a bar for the middle 50 % of reported prices (p25–p75) and a dot for the
// median, so dips and spikes stand out. Under it, the official wholesale cost, which has full history today.
// Every day keeps its own slot, so days without data show as gaps instead of being stretched over.
import { useState } from 'react';
import { type Fuel, FUEL_LABELS, type OutlookResponse } from './api';
import { osloToday, price2 } from './format';

const DAYS = 30;
const W = 320;
const P = { l: 34, r: 6, t: 6, b: 4 };
const DIP = 0.5; // a day's median this far from the 30-day typical level is coloured as a dip/spike

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const shortLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The last DAYS Oslo dates, oldest first, ending today. */
function slots(): string[] {
  const end = Date.parse(`${osloToday()}T12:00:00Z`);
  return Array.from({ length: DAYS }, (_, i) => new Date(end - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export function HistoryChart({ outlook, fuel }: { outlook: OutlookResponse | null; fuel: Fuel }) {
  const days = slots();
  const latest = outlook?.spread.at(-1)?.day ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  if (!outlook || outlook.fuel !== fuel) return null;

  const { spread, wdi } = outlook;
  const byDay = new Map(spread.map((s) => [s.day, s]));
  const x = (i: number) => P.l + ((i + 0.5) * (W - P.l - P.r)) / DAYS;
  const slotW = (W - P.l - P.r) / DAYS;
  const typical = spread.length >= 5 ? median(spread.map((s) => s.p50)) : null;
  const sel = byDay.get(picked ?? latest ?? '') ?? null;
  const first = spread[0]?.day;

  return (
    <section aria-labelledby="hist-h" className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="hist-h" className="text-sm font-semibold">
          {FUEL_LABELS[fuel]} · last 30 days
        </h2>
        <span className="text-[11px] text-muted">bar = middle 50 % · dot = median</span>
      </div>

      {spread.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No daily history yet: a day needs at least 20 reported prices.</p>
      ) : (
        <Bands days={days} byDay={byDay} x={x} slotW={slotW} typical={typical} picked={sel?.day ?? null} onPick={setPicked} />
      )}

      {sel && (
        <p className="mt-1 text-xs" aria-live="polite">
          <span className="font-medium">{dayLabel(sel.day)}{sel.day === osloToday() ? ' (so far)' : ''}</span>: p25{' '}
          <span className="num">{price2(sel.p25)}</span> · median <span className="num font-semibold">{price2(sel.p50)}</span> · p75{' '}
          <span className="num">{price2(sel.p75)}</span>
          {typical !== null && (
            <>
              {' '}
              · typical <span className="num">{price2(typical)}</span>
            </>
          )}
        </p>
      )}
      {first && spread.length < DAYS && (
        <p className="mt-1 text-[11px] text-muted">
          Pumpevakt started recording on {shortLabel(first)}, so the chart fills in day by day. The typical level and
          dip/spike colours appear after 5 days.
        </p>
      )}

      {fuel === 'diesel' && wdi.length >= 2 && <Wholesale days={days} wdi={wdi} x={x} />}
    </section>
  );
}

function Bands({
  days,
  byDay,
  x,
  slotW,
  typical,
  picked,
  onPick,
}: {
  days: string[];
  byDay: Map<string, OutlookResponse['spread'][number]>;
  x: (i: number) => number;
  slotW: number;
  typical: number | null;
  picked: string | null;
  onPick: (d: string) => void;
}) {
  const H = 130;
  const vals = [...byDay.values()].flatMap((s) => [s.p25, s.p75]);
  const lo = Math.floor(Math.min(...vals) - 0.3);
  const hi = Math.ceil(Math.max(...vals) + 0.3);
  const y = (v: number) => P.t + ((hi - v) * (H - P.t - P.b)) / (hi - lo);
  const ticks = [lo, (lo + hi) / 2, hi];
  // Median line only across consecutive days with data.
  const segs: string[][] = [];
  days.forEach((d, i) => {
    const s = byDay.get(d);
    if (!s) return void segs.push([]);
    (segs.at(-1) ?? segs[segs.push([]) - 1]!).push(`${x(i).toFixed(1)},${y(s.p50).toFixed(1)}`);
  });
  const tone = (p50: number) =>
    typical === null ? 'var(--ink)' : p50 <= typical - DIP ? 'var(--cheap)' : p50 >= typical + DIP ? 'var(--pricey)' : 'var(--ink)';

  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="mt-2 w-full" role="img" aria-label="Daily price range for the last 30 days">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
          <text x={P.l - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--ink-muted)" className="num">
            {t.toFixed(t % 1 ? 1 : 0)}
          </text>
        </g>
      ))}
      {typical !== null && (
        <line x1={P.l} x2={W - P.r} y1={y(typical)} y2={y(typical)} stroke="var(--ink-muted)" strokeDasharray="3 3" strokeWidth={1} />
      )}
      {segs.filter((s) => s.length > 1).map((s, i) => (
        <polyline key={i} points={s.join(' ')} fill="none" stroke="var(--ink-muted)" strokeWidth={1} />
      ))}
      {days.map((d, i) => {
        const s = byDay.get(d);
        if (!s) return null;
        const bw = Math.max(3, slotW * 0.6);
        return (
          <g key={d} onClick={() => onPick(d)} style={{ cursor: 'pointer' }}>
            <rect x={x(i) - slotW / 2} y={P.t} width={slotW} height={H - P.t - P.b} fill="transparent" />
            <rect
              x={x(i) - bw / 2}
              y={y(s.p75)}
              width={bw}
              height={Math.max(1, y(s.p25) - y(s.p75))}
              rx={1.5}
              fill="color-mix(in srgb, var(--ink) 14%, transparent)"
              stroke={d === picked ? 'var(--ink)' : 'none'}
            />
            <circle cx={x(i)} cy={y(s.p50)} r={d === picked ? 3.2 : 2.4} fill={tone(s.p50)} />
          </g>
        );
      })}
      <text x={P.l} y={H + 12} fontSize={9} fill="var(--ink-muted)">
        {shortLabel(days[0]!)}
      </text>
      <text x={W - P.r} y={H + 12} fontSize={9} fill="var(--ink-muted)" textAnchor="end">
        today
      </text>
    </svg>
  );
}

function Wholesale({ days, wdi, x }: { days: string[]; wdi: OutlookResponse['wdi']; x: (i: number) => number }) {
  const H = 44;
  const pts = wdi.map((w) => ({ i: days.indexOf(w.day), v: w.value })).filter((p) => p.i >= 0);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const y = (v: number) => 4 + ((hi - v) * (H - 8)) / Math.max(0.01, hi - lo);
  const last = pts.at(-1)!;
  const change = Math.round((last.v - pts[0]!.v) * 100) / 100;
  return (
    <figure className="mt-3 border-t border-line pt-2">
      <figcaption className="flex items-baseline justify-between text-xs">
        <span className="text-muted">Wholesale cost (official, before tax)</span>
        <span>
          <span className="num font-medium">{price2(last.v)}</span> kr/L{' '}
          <span className={`num ${change < 0 ? 'text-cheap' : change > 0 ? 'text-pricey' : 'text-muted'}`}>
            {change < 0 ? '▼' : change > 0 ? '▲' : '='}
            {price2(Math.abs(change))}
          </span>{' '}
          <span className="text-muted">in {pts.length} trading days</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`Wholesale diesel cost, ${price2(last.v)} kroner per litre`}>
        <text x={P.l - 4} y={y(hi) + 3} textAnchor="end" fontSize={9} fill="var(--ink-muted)" className="num">
          {hi.toFixed(2)}
        </text>
        <text x={P.l - 4} y={y(lo) + 3} textAnchor="end" fontSize={9} fill="var(--ink-muted)" className="num">
          {lo.toFixed(2)}
        </text>
        <polyline
          points={pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      </svg>
      <p className="text-[11px] text-muted">Monthly Oslo pump prices tracked this closely in our backtest (r = 0.92, SSB data).</p>
    </figure>
  );
}
