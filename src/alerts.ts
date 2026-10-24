// Alerts: raise (idempotent by dedupe_key), deliver by the docs/04 §4 rules, push to every subscribed
// browser. Runs after each scheduled job; never throws (a broken alert path must not break data collection).
import { decide, type AlertKind } from './core/delivery';
import { jobHealth } from './core/health';
import { osloDate } from './core/time';
import { recentRuns, type Job } from './db';
import { sendPush, type Note, type Subscription, type Vapid } from './push';
import type { Env } from './types';

export interface AlertRow {
  id: number;
  kind: AlertKind;
  dedupeKey: string;
  payload: Note & Record<string, unknown>;
  status: 'pending' | 'sent' | 'shadow' | 'dropped';
  createdAt: string;
  sentAt: string | null;
  feedback: 'up' | 'down' | null;
}

/** Insert unless the dedupe_key exists. Returns true when a new alert was created. */
export async function raiseAlert(db: D1Database, a: { kind: AlertKind; dedupeKey: string; payload: Note & Record<string, unknown>; createdAt: string }): Promise<boolean> {
  const r = await db
    .prepare(`INSERT INTO alerts (kind, dedupe_key, payload, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (dedupe_key) DO NOTHING`)
    .bind(a.kind, a.dedupeKey, JSON.stringify(a.payload), a.createdAt)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

export async function listAlerts(db: D1Database, sinceIso: string): Promise<AlertRow[]> {
  const { results } = await db
    .prepare(`SELECT id, kind, dedupe_key, payload, status, created_at, sent_at, feedback FROM alerts WHERE created_at >= ?1 ORDER BY id DESC LIMIT 200`)
    .bind(sinceIso)
    .all<{ id: number; kind: AlertKind; dedupe_key: string; payload: string; status: AlertRow['status']; created_at: string; sent_at: string | null; feedback: AlertRow['feedback'] }>();
  return results.map((r) => ({
    id: r.id,
    kind: r.kind,
    dedupeKey: r.dedupe_key,
    payload: JSON.parse(r.payload) as AlertRow['payload'],
    status: r.status,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    feedback: r.feedback,
  }));
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare(`SELECT value FROM settings WHERE key = ?1`).bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
}

/** Shadow mode is on until the owner turns it off (docs/04 §4: 14 days of calibration first). */
export const shadowOn = async (db: D1Database): Promise<boolean> => (await getSetting(db, 'shadow')) !== 'off';

export function vapidFromEnv(env: Env): Vapid | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return null;
  try {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey, subject: env.VAPID_SUBJECT ?? 'https://github.com/mariolallana/pumpevakt' };
  } catch {
    console.error('VAPID_PRIVATE_JWK is not valid JSON');
    return null;
  }
}

/** Push `note` to every subscription; forget the ones the browser dropped. */
export async function notifyAll(env: Env, note: Note, deps: { fetchFn?: typeof fetch; now?: Date } = {}): Promise<{ sent: number; gone: number; failed: number }> {
  const out = { sent: 0, gone: 0, failed: 0 };
  const vapid = vapidFromEnv(env);
  if (!vapid) return out;
  const { results } = await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions`).all<Subscription>();
  const nowIso = (deps.now ?? new Date()).toISOString();
  for (const sub of results) {
    const r = await sendPush(sub, note, vapid, deps.fetchFn ?? fetch, Date.parse(nowIso));
    out[r]++;
    if (r === 'gone') await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?1`).bind(sub.endpoint).run();
    if (r === 'sent') await env.DB.prepare(`UPDATE push_subscriptions SET last_ok_at = ?2 WHERE endpoint = ?1`).bind(sub.endpoint, nowIso).run();
  }
  return out;
}

/** Still worth sending? Return false to drop (e.g. the price went back up, the source recovered). */
export type Revalidate = (a: AlertRow) => Promise<boolean>;

/** Decide every pending alert; push the ones due. */
export async function deliverPending(env: Env, deps: { fetchFn?: typeof fetch; now?: Date; revalidate?: Revalidate } = {}): Promise<{ sent: number; held: number; shadow: number; dropped: number }> {
  const now = deps.now ?? new Date();
  const out = { sent: 0, held: 0, shadow: 0, dropped: 0 };
  const pending = (await listAlerts(env.DB, new Date(now.getTime() - 3 * 86_400_000).toISOString())).filter((a) => a.status === 'pending').reverse();
  if (pending.length === 0) return out;
  const [shadow, mutedUntil, recent] = await Promise.all([
    shadowOn(env.DB),
    getSetting(env.DB, 'mute_until'),
    env.DB.prepare(`SELECT sent_at FROM alerts WHERE status = 'sent' AND sent_at >= ?1`).bind(new Date(now.getTime() - 26 * 3_600_000).toISOString()).all<{ sent_at: string }>(),
  ]);
  const today = osloDate(now);
  let sentToday = recent.results.filter((r) => osloDate(new Date(r.sent_at)) === today).length;
  const setStatus = (id: number, status: AlertRow['status'], sentAt: string | null = null) =>
    env.DB.prepare(`UPDATE alerts SET status = ?2, sent_at = ?3 WHERE id = ?1`).bind(id, status, sentAt).run();

  for (const a of pending) {
    const d = decide(a, { now, shadow, mutedUntil, sentToday });
    if (d === 'hold') {
      out.held++;
      continue;
    }
    if (d === 'shadow') {
      await setStatus(a.id, 'shadow');
      out.shadow++;
      continue;
    }
    if (d === 'drop' || (deps.revalidate && !(await deps.revalidate(a)))) {
      await setStatus(a.id, 'dropped');
      out.dropped++;
      continue;
    }
    const r = await notifyAll(env, { title: a.payload.title, body: a.payload.body, url: a.payload.url ?? '/', tag: a.payload.tag }, deps);
    // No subscription yet still counts as delivered: the alert is visible in the app's alert list.
    await setStatus(a.id, 'sent', now.toISOString());
    sentToday++;
    out.sent++;
    if (r.failed > 0) console.error(`alert ${a.id}: ${r.failed} push(es) failed`);
  }
  return out;
}

/** Health alarm (docs/00 M5): a job that failed twice in a row raises one alert per outage. */
export async function raiseHealthAlert(env: Env, job: Job, now: Date): Promise<boolean> {
  const h = jobHealth(
    (await recentRuns(env.DB, job, 10)).map((r) => ({ startedAt: r.startedAt, finishedAt: r.finishedAt, ok: r.ok, detail: r.detail })),
  );
  if (h.consecutiveFailures < 2) return false;
  return raiseAlert(env.DB, {
    kind: 'system',
    dedupeKey: `system:${job}:${h.lastOk ?? 'never'}`, // one alert per outage
    createdAt: now.toISOString(),
    payload: {
      title: job === 'prices' ? '⚠️ Pumpevakt: price updates are failing' : '⚠️ Pumpevakt: market data is failing',
      body: `${h.consecutiveFailures} runs in a row failed (${String(h.lastError?.error ?? 'unknown error').slice(0, 120)}). Prices in the app may be out of date.`,
      url: '/',
      tag: `system-${job}`,
      job,
    },
  });
}

/** Still failing? Used to drop a held health alert once the job has recovered. */
export async function healthStillFailing(env: Env, a: AlertRow): Promise<boolean> {
  if (a.kind !== 'system' || typeof a.payload.job !== 'string') return true;
  const runs = await recentRuns(env.DB, a.payload.job as Job, 10);
  return jobHealth(runs.map((r) => ({ startedAt: r.startedAt, finishedAt: r.finishedAt, ok: r.ok, detail: r.detail }))).consecutiveFailures >= 2;
}
