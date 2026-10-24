// Owner-only: turn alarms on for this phone, test, mute, and review every alarm with 👍/👎 (docs/04 §4:
// shadow mode shows what *would* have been sent, so the thresholds can be judged before going live).
import { useCallback, useEffect, useState } from 'react';
import { disablePush, enablePush, here, ownerJson, pushState, type AlertsResponse, type FillupsResponse, type OwnerAlert, type PushState } from './alarms';

const KIND_ICON: Record<OwnerAlert['kind'], string> = { market_drop: '📉', outlier: '⛽', system: '⚠️' };
const STATUS: Record<OwnerAlert['status'], string> = { sent: 'sent', shadow: 'would have sent', pending: 'waiting (quiet hours / limit)', dropped: 'dropped (no longer true)' };

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function AlarmsCard({ ownerKey }: { ownerKey: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [fills, setFills] = useState<FillupsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    pushState().then(setState).catch(() => setState('unsupported'));
    ownerJson<AlertsResponse>(ownerKey, '/alerts').then(setData).catch((e: unknown) => setMsg(`Couldn’t load alarms: ${e instanceof Error ? e.message : e}`));
    ownerJson<FillupsResponse>(ownerKey, '/fillups').then(setFills).catch(() => {});
  }, [ownerKey]);
  useEffect(refresh, [refresh]);

  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg(done);
    } catch (e) {
      setMsg(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const vote = (a: OwnerAlert, v: 'up' | 'down') =>
    run('Saving', () => ownerJson(ownerKey, `/alerts/${a.id}/feedback`, { vote: a.feedback === v ? null : v }));

  const btn = 'min-h-11 rounded-lg border px-3 text-sm font-medium disabled:opacity-60';

  return (
    <section aria-labelledby="alarms-h" className="rounded-xl border border-line bg-surface p-3">
      <h2 id="alarms-h" className="text-sm font-semibold">
        🔔 Your alarms
      </h2>

      <div className="mt-2 text-sm">
        {state === 'needs-install' && (
          <p>
            On iPhone, alarms only work from the installed app: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open Pumpevakt
            from your home screen, and turn alarms on there.
          </p>
        )}
        {state === 'unsupported' && <p className="text-muted">This browser can’t receive notifications.</p>}
        {state === 'denied' && <p>Notifications are blocked for this app. Allow them in your phone’s settings for Pumpevakt, then reload.</p>}
        {state === 'off' && (
          <button type="button" disabled={busy} className={`${btn} border-ink bg-ink text-bg`} onClick={() => run('Turning on', () => enablePush(ownerKey), 'Alarms are on for this phone.')}>
            Turn on alarms on this phone
          </button>
        )}
        {state === 'on' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-cheap">✓ On for this phone</span>
            <button type="button" disabled={busy} className={`${btn} border-line`} onClick={() => run('Test', async () => {
              const r = await ownerJson<{ sent: number; failed: number }>(ownerKey, '/test', {});
              if (r.sent === 0) throw new Error(r.failed ? 'the push service refused it' : 'no phone is registered');
            }, 'Test sent: it should appear within a few seconds.')}>
              Send test
            </button>
            <button type="button" disabled={busy} className={`${btn} border-line`} onClick={() => run('Turning off', () => disablePush(ownerKey))}>
              Turn off
            </button>
          </div>
        )}
      </div>

      {data && (
        <div className="mt-3 space-y-1 text-xs text-muted">
          {data.shadow && (
            <p>
              <strong className="text-ink">Shadow mode:</strong> price alarms are listed here but not sent for the first 14 days, so we can check
              they would have been right. Health alarms (data source down) are always sent.
            </p>
          )}
          <p>Quiet 22–07 · at most 3 a day.</p>
          <div className="flex flex-wrap items-center gap-2">
            {data.mutedUntil ? (
              <>
                <span>Price alarms muted until {when(data.mutedUntil)}.</span>
                <button type="button" disabled={busy} className={`${btn} border-line text-ink`} onClick={() => run('Unmute', () => ownerJson(ownerKey, '/mute', { hours: 0 }))}>
                  Unmute
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} className={`${btn} border-line text-ink`} onClick={() => run('Mute', () => ownerJson(ownerKey, '/mute', { hours: 24 }))}>
                Mute price alarms 24 h
              </button>
            )}
          </div>
        </div>
      )}

      {data && (
        <div className="mt-3 border-t border-line pt-2 text-sm">
          <h3 className="text-xs font-semibold text-muted">Home</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            {data.home ? (
              <span>
                Set {new Date(data.home.setAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} (kept private, ~100 m precision). Cheap-station
                alarms cover 15 km around it.
              </span>
            ) : (
              <span className="text-muted">Not set. Cheap-station alarms need it: tap this while you’re at home.</span>
            )}
            <button
              type="button"
              disabled={busy}
              className={`${btn} border-line`}
              onClick={() => run('Setting Home', async () => ownerJson(ownerKey, '/home', await here()), 'Home saved.')}
            >
              📍 {data.home ? 'Move Home here' : 'Set Home to where I am'}
            </button>
          </p>
        </div>
      )}

      {fills && (
        <div className="mt-3 border-t border-line pt-2 text-sm">
          <h3 className="text-xs font-semibold text-muted">⛽ Your fill-ups</h3>
          {fills.n === 0 ? (
            <p className="mt-1 text-muted">None yet. When you fill up, tap the station, then “⛽ I filled up here”.</p>
          ) : (
            <p className="mt-1">
              {fills.n} fill-up{fills.n === 1 ? '' : 's'} · on average{' '}
              <span className={`num font-semibold ${fills.avgSavingPerL! >= fills.goalPerL ? 'text-cheap' : ''}`}>
                {fills.avgSavingPerL! >= 0 ? `${fills.avgSavingPerL!.toFixed(2)} kr/L below` : `${Math.abs(fills.avgSavingPerL!).toFixed(2)} kr/L above`}
              </span>{' '}
              the Oslo average (goal: {fills.goalPerL.toFixed(2)} below).
            </p>
          )}
        </div>
      )}

      {msg && (
        <p role="status" className="mt-2 text-sm">
          {msg}
        </p>
      )}

      {data && (
        <div className="mt-3 border-t border-line pt-2">
          <h3 className="text-xs font-semibold text-muted">Last 30 days</h3>
          {data.alerts.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No alarms yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-2 py-2">
                  <span aria-hidden="true">{KIND_ICON[a.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-sm">{a.body}</p>
                    <p className="text-xs text-muted">
                      {when(a.createdAt)} · {STATUS[a.status]}
                    </p>
                  </div>
                  {a.kind !== 'system' && (
                    <div className="flex shrink-0 gap-1" role="group" aria-label="Was this alarm right?">
                      {(['up', 'down'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          disabled={busy}
                          aria-pressed={a.feedback === v}
                          aria-label={v === 'up' ? 'Right alarm' : 'Wrong alarm'}
                          onClick={() => vote(a, v)}
                          className={`min-h-11 min-w-11 rounded-lg border text-lg ${a.feedback === v ? 'border-ink bg-bg' : 'border-line'}`}
                        >
                          {v === 'up' ? '👍' : '👎'}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
