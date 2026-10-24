// Owner-only API under /api/owner/* (push subscription, alerts with 👍/👎, mute, shadow mode, fill-ups).
// Guarded by the same secret as /api/feedback (FEEDBACK_KEY, sent as X-Feedback-Key): one owner, no accounts.
import { deliverPending, getSetting, listAlerts, notifyAll, setSetting, shadowOn, vapidFromEnv } from './alerts';
import type { Env } from './types';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (message: string) => json({ error: { code: 'BAD_INPUT', message } }, 400);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const B64U = /^[A-Za-z0-9_-]+$/;

export function parseSubscription(body: unknown): { endpoint: string; p256dh: string; auth: string } | string {
  if (!isObj(body) || typeof body.endpoint !== 'string' || !isObj(body.keys)) return 'expected a PushSubscription: { endpoint, keys: { p256dh, auth } }';
  let url: URL;
  try {
    url = new URL(body.endpoint);
  } catch {
    return 'endpoint must be a URL';
  }
  if (url.protocol !== 'https:' || body.endpoint.length > 1000) return 'endpoint must be an https URL';
  const { p256dh, auth } = body.keys;
  if (typeof p256dh !== 'string' || !B64U.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return 'keys.p256dh must be a base64url P-256 key';
  if (typeof auth !== 'string' || !B64U.test(auth) || auth.length < 16 || auth.length > 32) return 'keys.auth must be a base64url secret';
  return { endpoint: body.endpoint, p256dh, auth };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Handles /api/owner/*; null for other paths. */
export async function handleOwner(request: Request, env: Env, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/owner/')) return null;
  if (!env.FEEDBACK_KEY || request.headers.get('X-Feedback-Key') !== env.FEEDBACK_KEY) {
    return json({ error: { code: 'UNAUTHORIZED', message: 'missing or wrong owner key' } }, 401);
  }
  const route = `${request.method} ${url.pathname.slice('/api/owner'.length)}`;
  const db = env.DB;

  if (route === 'GET /push') {
    const n = await db.prepare(`SELECT count(*) AS n FROM push_subscriptions`).first<{ n: number }>();
    return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null, subscriptions: n?.n ?? 0, configured: vapidFromEnv(env) !== null });
  }
  if (route === 'POST /subscribe') {
    const sub = parseSubscription(await readJson(request));
    if (typeof sub === 'string') return bad(sub);
    await db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .bind(sub.endpoint, sub.p256dh, sub.auth, now.toISOString())
      .run();
    return json({ ok: true }, 201);
  }
  if (route === 'POST /unsubscribe') {
    const body = await readJson(request);
    if (!isObj(body) || typeof body.endpoint !== 'string') return bad('expected { endpoint }');
    await db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?1`).bind(body.endpoint).run();
    return json({ ok: true });
  }
  if (route === 'POST /test') {
    // A test push skips the delivery rules on purpose: it answers "do notifications reach my phone?".
    const r = await notifyAll(env, { title: '🔔 Pumpevakt notifications work', body: 'Alarms will look like this. You can mute them in the app.', url: '/', tag: 'test' });
    return json(r);
  }
  if (route === 'GET /alerts') {
    const [alerts, shadow, mutedUntil] = await Promise.all([
      listAlerts(db, new Date(now.getTime() - 30 * 86_400_000).toISOString()),
      shadowOn(db),
      getSetting(db, 'mute_until'),
    ]);
    return json({
      shadow,
      mutedUntil: mutedUntil && Date.parse(mutedUntil) > now.getTime() ? mutedUntil : null,
      alerts: alerts.map((a) => ({ id: a.id, kind: a.kind, status: a.status, createdAt: a.createdAt, sentAt: a.sentAt, feedback: a.feedback, title: a.payload.title, body: a.payload.body })),
    });
  }
  const fb = /^POST \/alerts\/(\d+)\/feedback$/.exec(route);
  if (fb) {
    const body = await readJson(request);
    const vote = isObj(body) ? body.vote : undefined;
    if (vote !== 'up' && vote !== 'down' && vote !== null) return bad('vote must be "up", "down" or null');
    const r = await db.prepare(`UPDATE alerts SET feedback = ?2 WHERE id = ?1`).bind(Number(fb[1]), vote).run();
    return (r.meta.changes ?? 0) > 0 ? json({ ok: true }) : json({ error: { code: 'NOT_FOUND', message: 'no such alert' } }, 404);
  }
  if (route === 'POST /mute') {
    const body = await readJson(request);
    const hours = isObj(body) ? body.hours : undefined;
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || hours > 72) return bad('hours must be 0–72');
    const until = hours === 0 ? '' : new Date(now.getTime() + hours * 3_600_000).toISOString();
    await setSetting(db, 'mute_until', until);
    return json({ mutedUntil: until || null });
  }
  if (route === 'POST /shadow') {
    const body = await readJson(request);
    if (!isObj(body) || typeof body.on !== 'boolean') return bad('expected { on: boolean }');
    await setSetting(db, 'shadow', body.on ? 'on' : 'off');
    if (!body.on) await deliverPending(env, { now });
    return json({ shadow: body.on });
  }
  return json({ error: { code: 'NOT_FOUND', message: `no route ${route}` } }, 404);
}
