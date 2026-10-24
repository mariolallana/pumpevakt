// Station list sorted by net saving (server order). The accessible mirror of the map.
import { Fragment, useEffect, useRef } from 'react';
import type { StationItem } from './api';
import { FeedbackPanel } from './FeedbackPanel';
import { age, delta, extraBrand, km, navUrl, price2, saving, toneClass } from './format';

interface Props {
  stations: StationItem[];
  refPrice: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When set (owner's feedback key), the selected row shows the 👍/👎/note panel. */
  feedback?: { key: string; fuel: string; where?: { lat: number; lon: number } };
}

export function StationList({ stations, refPrice, selectedId, onSelect, feedback }: Props) {
  const refs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    if (selectedId) refs.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <ol className="divide-y divide-line" aria-label="Stations, best net saving first">
      {stations.map((s, i) => {
        const d = delta(s.price, refPrice);
        const sv = saving(s.netSavingNok);
        const selected = s.id === selectedId;
        const brand = extraBrand(s.name, s.brand);
        // Stale rows are greyed by colour (--ink-muted), never by opacity, so they keep AA contrast.
        const doubtful = s.stale || s.unconfirmed;
        const valueTone = (t: keyof typeof toneClass) => (doubtful ? 'text-muted' : toneClass[t]);
        return (
          <Fragment key={s.id}>
          <li
            ref={(n) => {
              if (n) refs.current.set(s.id, n);
              else refs.current.delete(s.id);
            }}
            className={`relative flex items-stretch gap-1 ${selected ? 'bg-[color-mix(in_srgb,var(--cheap)_10%,var(--surface))]' : ''}`}
          >
            {selected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-ink" />}
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              aria-pressed={selected}
              aria-label={`${i + 1}. ${s.name}${brand ? `, ${brand}` : ''}: ${price2(s.price)} kroner per litre, ${km(s.distanceKm)}, updated ${age(s.ageMinutes)}${s.stale ? ' (stale)' : ''}${s.unconfirmed ? ' (unconfirmed: far below other recent prices)' : ''}${d ? `, ${d.text}` : ''}${sv ? `, ${sv.text}` : ''}. Show on map`}
              className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-1 text-left"
            >
              <span className="w-[4.5rem] shrink-0">
                <span className={`num block text-xl font-semibold leading-tight ${doubtful ? 'text-muted' : ''}`}>{price2(s.price)}</span>
                {d && (
                  <span className={`num block text-xs ${valueTone(d.tone)}`}>
                    {d.arrow} {d.tone === 'neutral' ? 'avg' : price2(Math.abs(s.price - (refPrice ?? s.price)))}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate font-medium ${s.stale ? 'text-muted' : ''}`}>{s.name}</span>
                {/* Distance never truncates; only the (non-duplicated) brand may. */}
                <span className="flex min-w-0 text-sm text-muted">
                  <span className="num shrink-0">{km(s.distanceKm)}</span>
                  {brand && <span className="truncate">&nbsp;· {brand}</span>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {sv && <span className={`num block text-sm font-medium ${valueTone(sv.tone)}`}>{sv.text}</span>}
                <span className={`num block text-xs ${doubtful ? 'font-medium text-alert' : 'text-muted'}`}>
                  {s.stale ? 'stale · ' : s.unconfirmed ? 'unconfirmed · ' : ''}
                  {age(s.ageMinutes)}
                </span>
              </span>
            </button>
            <a
              href={navUrl(s.lat, s.lon)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Navigate to ${s.name} in Google Maps (opens in a new tab)`}
              title="Navigate (Google Maps)"
              className="flex min-h-[44px] w-12 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-bg"
            >
              <span aria-hidden="true">🧭</span>
            </a>
          </li>
          {selected && feedback && (
            <li className="px-4 pb-3">
              <FeedbackPanel feedbackKey={feedback.key} fuel={feedback.fuel} station={s} where={feedback.where} />
            </li>
          )}
          </Fragment>
        );
      })}
    </ol>
  );
}

export function ListSkeleton() {
  return (
    <ul aria-hidden="true" className="divide-y divide-line">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-4">
          <div className="skeleton h-7 w-16" />
          <div className="flex-1">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton mt-2 h-3 w-1/2" />
          </div>
          <div className="skeleton h-4 w-14" />
        </li>
      ))}
    </ul>
  );
}
