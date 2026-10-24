// Owner-only API under /api/owner/* (push subscription, alerts with 👍/👎, mute, shadow mode, fill-ups).
// Guarded by the same secret as /api/feedback (FEEDBACK_KEY, sent as X-Feedback-Key): one owner, no accounts.
import { deliverPending, getSetting, listAlerts, notifyAll, setSetting, shadowOn, vapidFromEnv } from './alerts';
import { latestOkPricesRun } from './db';
import type { Env } from './types';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = (message: string) => json({ error: { code: 'BAD_INPUT', message } }, 400);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const B64U = /^[A-Za-z0-9_-]+$/;

/** Owner's Home, set from the app (never in the public repo). Rounded to 3 decimals (~100 m). */
export interface Home {
  lat: number;
  lon: number;
  setAt: string;
}

export async function getHome(db: D1Database): Promise<Home | null> {
  const raw = await getSetting(db, 'home');
  if (!raw) return null;
  try {
    const h = JSON.parse(raw) as Home;
    return Number.isFinite(h.lat) && Number.isFinite(h.lon) ? h : null;
  } catch {
    return null;
  }
}

const FILLUP_FUELS = ['diesel', 'petrol95'];

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
      home: await getHome(db),
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
  if (route === 'POST /home') {
    const body = await readJson(request);
    if (isObj(body) && body.clear === true) {
      await setSetting(db, 'home', '');
      return json({ home: null });
    }
    const lat = isObj(body) ? body.lat : undefined;
    const lon = isObj(body) ? body.lon : undefined;
    // Greater Oslo only: the alarms are about Oslo stations.
    if (typeof lat !== 'number' || typeof lon !== 'number' || lat < 59.6 || lat > 60.3 || lon < 10.2 || lon > 11.4) return bad('lat/lon must be in the Oslo area');
    const home: Home = { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, setAt: now.toISOString() };
    await setSetting(db, 'home', JSON.stringify(home));
    return json({ home });
  }
  if (route === 'POST /fillup') {
    const body = await readJson(request);
    if (!isObj(body)) return bad('expected { stationId, fuel, price }');
    const { stationId, fuel, price } = body;
    if (typeof stationId !== 'string' || !stationId) return bad('stationId is required');
    if (typeof fuel !== 'string' || !FILLUP_FUELS.includes(fuel)) return bad(`fuel must be one of ${FILLUP_FUELS.join(', ')}`);
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 5 || price > 60) return bad('price must be between 5 and 60');
    const station = await db.prepare(`SELECT name FROM stations WHERE id = ?1`).bind(stationId).first<{ name: string }>();
    if (!station) return bad('unknown station');
    const run = await latestOkPricesRun(db);
    const level = fuel === 'diesel' ? (run?.levels?.diesel ?? run?.level ?? null) : (run?.levels?.[fuel] ?? null);
    if (level === null) return json({ error: { code: 'NO_LEVEL', message: 'no current Oslo average to compare with; try again in 30 min' } }, 409);
    const osloMedian = Math.round(level * 100) / 100;
    await db
      .prepare(`INSERT INTO fillups (station_id, price, oslo_median, at, fuel) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(stationId, price, osloMedian, now.toISOString(), fuel)
      .run();
    return json({ osloMedian, savingPerL: Math.round((osloMedian - price) * 100) / 100 }, 201);
  }
  if (route === 'GET /fillups') {
    const { results } = await db
      .prepare(
        `SELECT f.id, f.at, f.fuel, f.price, f.oslo_median AS osloMedian, s.name AS stationName
         FROM fillups f JOIN stations s ON s.id = f.station_id WHERE f.at >= ?1 ORDER BY f.at DESC`,
      )
      .bind(new Date(now.getTime() - 365 * 86_400_000).toISOString())
      .all<{ id: number; at: string; fuel: string; price: number; osloMedian: number; stationName: string }>();
    const savings = results.map((r) => r.osloMedian - r.price);
    const avg = savings.length ? Math.round((savings.reduce((a, b) => a + b, 0) / savings.length) * 100) / 100 : null;
    return json({ n: results.length, avgSavingPerL: avg, goalPerL: 1, fillups: results });
  }
  return json({ error: { code: 'NOT_FOUND', message: `no route ${route}` } }, 404);
}
