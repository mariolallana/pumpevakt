// Inline 👍 / 👎 / note form for one station, or a general note when `station` is omitted.
import { useState } from 'react';
import type { StationItem } from './api';
import { sendFeedback, type FeedbackBody } from './feedback';

interface Props {
  feedbackKey: string;
  fuel: string;
  station?: StationItem;
  where?: { lat: number; lon: number };
  onDone?: () => void;
}

export function FeedbackPanel({ feedbackKey, fuel, station, where, onDone }: Props) {
  const [mode, setMode] = useState<'pick' | 'wrong' | 'note'>(station ? 'pick' : 'note');
  const [actual, setActual] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | string>('idle');

  const submit = async (verdict: FeedbackBody['verdict']) => {
    const parsed = Number(actual.replace(',', '.'));
    setState('sending');
    try {
      await sendFeedback(feedbackKey, {
        verdict,
        fuel,
        note: note.trim() || undefined,
        actualPrice: actual.trim() && Number.isFinite(parsed) ? parsed : undefined,
        ...(station
          ? { stationId: station.id, stationName: station.name, appPrice: station.price, appObservedAt: station.observedAt }
          : {}),
        ...(where ?? {}),
      });
      setState('sent');
      setTimeout(() => onDone?.(), 1200);
    } catch (e) {
      setState(e instanceof Error ? e.message : 'failed');
    }
  };

  if (state === 'sent') return <p className="rounded-lg bg-bg px-3 py-2 text-sm" role="status">Thanks, saved ✓</p>;

  const btn = 'min-h-11 rounded-lg border border-line px-3 text-sm font-medium';
  return (
    <div className="space-y-2 rounded-lg border border-line bg-bg p-3 text-sm">
      {mode === 'pick' && (
        <div className="flex flex-wrap gap-2">
          <span className="w-full text-muted">Is {station?.name}’s price right?</span>
          <button type="button" className={btn} onClick={() => submit('ok')} disabled={state === 'sending'}>👍 Correct</button>
          <button type="button" className={btn} onClick={() => setMode('wrong')}>👎 Wrong</button>
          <button type="button" className={btn} onClick={() => setMode('note')}>📝 Note</button>
        </div>
      )}
      {mode === 'wrong' && (
        <label className="block">
          <span className="text-muted">Price on the sign (kr/L)</span>
          <input
            inputMode="decimal"
            autoFocus
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder="e.g. 29.18"
            className="num mt-1 block min-h-11 w-full rounded-lg border border-line bg-surface px-3"
          />
        </label>
      )}
      {(mode === 'wrong' || mode === 'note') && (
        <>
          <label className="block">
            <span className="text-muted">{mode === 'note' && !station ? 'Your note (bug, idea, anything)' : 'Note (optional)'}</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              autoFocus={mode === 'note'}
              className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${btn} bg-ink text-bg`}
              disabled={state === 'sending' || (mode === 'note' && !note.trim())}
              onClick={() => submit(mode)}
            >
              {state === 'sending' ? 'Saving…' : 'Send'}
            </button>
            {station && <button type="button" className={btn} onClick={() => setMode('pick')}>Back</button>}
          </div>
        </>
      )}
      {state !== 'idle' && state !== 'sending' && <p className="text-alert" role="alert">Couldn’t save: {state}</p>}
    </div>
  );
}
