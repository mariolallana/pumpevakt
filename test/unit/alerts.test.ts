import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverPending, raiseAlert, raiseHealthAlert } from '../../src/alerts';
import { decide, inQuietHours } from '../../src/core/delivery';
import { b64u } from '../../src/push';
import { handleFetch, PRICES_CRON, runScheduled } from '../../src/routes';
import { createTestDb, rows } from './helpers';

let t: Awaited<ReturnType<typeof createTestDb>>;
let vapid: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_JWK: string };
beforeAll(async () => {
  t = await createTestDb();
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  vapid = {
    VAPID_PUBLIC_KEY: b64u.encode(new Uint8Array((await crypto.subtle.exportKey('raw', k.publicKey)) as ArrayBuffer)),
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey)),
  };
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  vi.restoreAllMocks();
});

const env = () => ({ ...t.env, FEEDBACK_KEY: 'k3y', ...vapid });
// 2026-10-24 is CEST: 12:00 UTC = 14:00 Oslo (daytime), 21:00 UTC = 23:00 Oslo (quiet hours).
const DAY = new Date('2026-10-24T12:00:00.000Z');
const NIGHT = new Date('2026-10-24T21:00:00.000Z');

async function browserSub() {
  const k = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: b64u.encode(new Uint8Array((await crypto.subtle.exportKey('raw', k.publicKey)) as ArrayBuffer)), auth: b64u.encode(crypto.getRandomValues(new Uint8Array(16))) },
  };
}
const owner = (path: string, init: RequestInit = {}, key = 'k3y') =>
  handleFetch(new Request(`https://x/api/owner${path}`, { ...init, headers: { 'content-type': 'application/json', 'X-Feedback-Key': key } }), env());

/** Push services answer 201; record every push. */
function fakePushService(status = 201) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return new Response('', { status });
  });
  return calls;
}

describe('delivery rules (docs/04 §4)', () => {
  const ctx = { now: DAY, shadow: false, mutedUntil: null, sentToday: 0 };
  const price = { kind: 'market_drop' as const, createdAt: DAY.toISOString() };
  const system = { kind: 'system' as const, createdAt: DAY.toISOString() };

  it('quiet hours are 22–07 Oslo time', () => {
    expect(inQuietHours(new Date('2026-10-24T19:59:00Z'))).toBe(false); // 21:59
    expect(inQuietHours(new Date('2026-10-24T20:00:00Z'))).toBe(true); // 22:00
    expect(inQuietHours(new Date('2026-10-25T05:59:00Z'))).toBe(true); // 06:59 CET
    expect(inQuietHours(new Date('2026-10-25T06:00:00Z'))).toBe(false); // 07:00 CET
  });

  it('price alarms: shadow > stale > quiet > mute > cap', () => {
    expect(decide(price, { ...ctx, shadow: true })).toBe('shadow');
    expect(decide({ ...price, createdAt: '2026-10-23T23:00:00Z' }, ctx)).toBe('drop'); // > 12 h old
    expect(decide(price, { ...ctx, now: NIGHT })).toBe('hold');
    expect(decide(price, { ...ctx, mutedUntil: '2026-10-25T00:00:00Z' })).toBe('hold');
    expect(decide(price, { ...ctx, sentToday: 3 })).toBe('hold');
    expect(decide(price, ctx)).toBe('send');
  });

  it('health alarms ignore shadow mode and mute, but respect quiet hours and the cap', () => {
    expect(decide(system, { ...ctx, shadow: true, mutedUntil: '2026-10-25T00:00:00Z' })).toBe('send');
    expect(decide(system, { ...ctx, now: NIGHT })).toBe('hold');
    expect(decide(system, { ...ctx, sentToday: 3 })).toBe('hold');
  });
});

describe('owner API', () => {
  it('rejects a missing or wrong key', async () => {
    expect((await owner('/push', {}, 'nope')).status).toBe(401);
  });

  it('subscribe validates and upserts; GET /push reports the key and count; test push reaches the browser', async () => {
    expect((await owner('/subscribe', { method: 'POST', body: JSON.stringify({ endpoint: 'http://insecure', keys: {} }) })).status).toBe(400);
    const sub = await browserSub();
    expect((await owner('/subscribe', { method: 'POST', body: JSON.stringify(sub) })).status).toBe(201);
    expect((await owner('/subscribe', { method: 'POST', body: JSON.stringify(sub) })).status).toBe(201); // idempotent
    expect(await (await owner('/push')).json()).toEqual({ publicKey: vapid.VAPID_PUBLIC_KEY, subscriptions: 1, configured: true });
    const calls = fakePushService();
    expect(await (await owner('/test', { method: 'POST' })).json()).toEqual({ sent: 1, gone: 0, failed: 0 });
    expect(calls).toEqual([sub.endpoint]);
  });

  it('a subscription the push service reports gone (410) is deleted', async () => {
    await owner('/subscribe', { method: 'POST', body: JSON.stringify(await browserSub()) });
    fakePushService(410);
    expect(await (await owner('/test', { method: 'POST' })).json()).toEqual({ sent: 0, gone: 1, failed: 0 });
    expect(await rows(t.db, 'SELECT * FROM push_subscriptions')).toEqual([]);
  });

  it('alerts list, 👍/👎, mute and shadow switch', async () => {
    await raiseAlert(t.db, { kind: 'market_drop', dedupeKey: 'market_drop:2026-10-24', createdAt: DAY.toISOString(), payload: { title: 'Diesel dropped', body: '−1.20 vs normal' } });
    const list = (await (await owner('/alerts')).json()) as { shadow: boolean; alerts: Array<{ id: number; title: string; status: string }> };
    expect(list.shadow).toBe(true);
    expect(list.alerts).toMatchObject([{ title: 'Diesel dropped', status: 'pending' }]);
    const id = list.alerts[0]!.id;
    expect((await owner(`/alerts/${id}/feedback`, { method: 'POST', body: JSON.stringify({ vote: 'down' }) })).status).toBe(200);
    expect((await owner(`/alerts/999/feedback`, { method: 'POST', body: JSON.stringify({ vote: 'up' }) })).status).toBe(404);
    expect((await owner('/mute', { method: 'POST', body: JSON.stringify({ hours: 99 }) })).status).toBe(400);
    const m = (await (await owner('/mute', { method: 'POST', body: JSON.stringify({ hours: 24 }) })).json()) as { mutedUntil: string };
    expect(Date.parse(m.mutedUntil)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    expect(await (await owner('/shadow', { method: 'POST', body: JSON.stringify({ on: false }) })).json()).toEqual({ shadow: false });
    const [row] = await rows<{ feedback: string }>(t.db, 'SELECT feedback FROM alerts');
    expect(row!.feedback).toBe('down');
  });
});

describe('deliverPending', () => {
  it('shadow mode logs price alarms without pushing; health alarms are pushed', async () => {
    await owner('/subscribe', { method: 'POST', body: JSON.stringify(await browserSub()) });
    const calls = fakePushService();
    await raiseAlert(t.db, { kind: 'outlier', dedupeKey: 'o1', createdAt: DAY.toISOString(), payload: { title: 'Cheap', body: 'b' } });
    await raiseAlert(t.db, { kind: 'system', dedupeKey: 's1', createdAt: DAY.toISOString(), payload: { title: 'Down', body: 'b' } });
    expect(await deliverPending(env(), { now: DAY })).toEqual({ sent: 1, held: 0, shadow: 1, dropped: 0 });
    expect(calls).toHaveLength(1);
    expect(await rows(t.db, 'SELECT dedupe_key, status FROM alerts ORDER BY id')).toEqual([
      { dedupe_key: 'o1', status: 'shadow' },
      { dedupe_key: 's1', status: 'sent' },
    ]);
  });

  it('holds in quiet hours, sends after them, and caps at 3 a day', async () => {
    fakePushService();
    for (let i = 0; i < 4; i++) await raiseAlert(t.db, { kind: 'system', dedupeKey: `s${i}`, createdAt: NIGHT.toISOString(), payload: { title: `S${i}`, body: 'b' } });
    expect(await deliverPending(env(), { now: NIGHT })).toMatchObject({ sent: 0, held: 4 });
    const morning = new Date('2026-10-25T06:30:00Z'); // 07:30 Oslo, 9.5 h later
    expect(await deliverPending(env(), { now: morning })).toMatchObject({ sent: 3, held: 1 });
  });

  it('revalidation can drop a held alert (e.g. the source recovered)', async () => {
    await raiseAlert(t.db, { kind: 'system', dedupeKey: 's', createdAt: DAY.toISOString(), payload: { title: 'Down', body: 'b' } });
    expect(await deliverPending(env(), { now: DAY, revalidate: async () => false })).toMatchObject({ sent: 0, dropped: 1 });
  });
});

describe('health alarm (docs/00 M5)', () => {
  it('two failed price runs in a row → one alert per outage, pushed after the run', async () => {
    await owner('/subscribe', { method: 'POST', body: JSON.stringify(await browserSub()) });
    const pushes: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('drivstoffapp')) return new Response('bad gateway', { status: 502 });
      pushes.push(url);
      return new Response('', { status: 201 });
    });
    await runScheduled(PRICES_CRON, env(), new Date('2026-10-24T12:00:00Z'));
    expect(await rows(t.db, 'SELECT * FROM alerts')).toEqual([]); // one failure is not an outage
    await runScheduled(PRICES_CRON, env(), new Date('2026-10-24T12:30:00Z'));
    await runScheduled(PRICES_CRON, env(), new Date('2026-10-24T13:00:00Z'));
    const alerts = await rows<{ kind: string; status: string; payload: string }>(t.db, 'SELECT kind, status, payload FROM alerts');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'system', status: 'sent' });
    expect(JSON.parse(alerts[0]!.payload).title).toMatch(/price updates are failing/);
    expect(pushes).toHaveLength(1);
    expect(await raiseHealthAlert(env(), 'prices', new Date('2026-10-24T13:30:00Z'))).toBe(false); // same outage, deduped
  });
});

describe('fill-ups and Home (docs/00 §5)', () => {
  async function seedStation() {
    await t.db.prepare(`INSERT INTO stations (id, name, brand, address, lat, lon) VALUES ('k', 'Kiellands Plass', 'Circle K', 'Gate 1', 59.9287, 10.7499)`).run();
    await t.db
      .prepare(`INSERT INTO runs (job, started_at, finished_at, ok, detail) VALUES ('prices', ?1, ?1, 1, ?2)`)
      .bind('2026-10-24T12:00:00.000Z', JSON.stringify({ level: 27.5, levels: { diesel: 27.5, petrol95: 28.9 } }))
      .run();
  }

  it('records the price paid against the current Oslo average and summarises the saving', async () => {
    await seedStation();
    const r = await owner('/fillup', { method: 'POST', body: JSON.stringify({ stationId: 'k', fuel: 'diesel', price: 26.3 }) });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ osloMedian: 27.5, savingPerL: 1.2 });
    await owner('/fillup', { method: 'POST', body: JSON.stringify({ stationId: 'k', fuel: 'petrol95', price: 28.5 }) });
    const s = (await (await owner('/fillups')).json()) as { n: number; avgSavingPerL: number; fillups: Array<{ stationName: string }> };
    expect(s).toMatchObject({ n: 2, avgSavingPerL: 0.8, goalPerL: 1 });
    expect(s.fillups[0]!.stationName).toBe('Kiellands Plass');
  });

  it('validates fuel, price and station; no current average → 409', async () => {
    expect((await owner('/fillup', { method: 'POST', body: JSON.stringify({ stationId: 'k', fuel: 'diesel', price: 26 }) })).status).toBe(400); // unknown station
    await t.db.prepare(`INSERT INTO stations (id, name, lat, lon) VALUES ('k', 'K', 59.9, 10.7)`).run();
    expect((await owner('/fillup', { method: 'POST', body: JSON.stringify({ stationId: 'k', fuel: 'hvo100', price: 26 }) })).status).toBe(400);
    expect((await owner('/fillup', { method: 'POST', body: JSON.stringify({ stationId: 'k', fuel: 'diesel', price: 2.6 }) })).status).toBe(400);
    expect((await owner('/fillup', { method: 'POST', body: JSON.stringify({ stationId: 'k', fuel: 'diesel', price: 26 }) })).status).toBe(409);
  });

  it('Home is set from the app, rounded to ~100 m, Oslo area only, and can be cleared', async () => {
    expect((await owner('/home', { method: 'POST', body: JSON.stringify({ lat: 48.85, lon: 2.35 }) })).status).toBe(400);
    const h = (await (await owner('/home', { method: 'POST', body: JSON.stringify({ lat: 59.94912, lon: 10.76543 }) })).json()) as { home: { lat: number; lon: number } };
    expect(h.home).toMatchObject({ lat: 59.949, lon: 10.765 });
    expect(((await (await owner('/alerts')).json()) as { home: unknown }).home).toMatchObject({ lat: 59.949, lon: 10.765 });
    await owner('/home', { method: 'POST', body: JSON.stringify({ clear: true }) });
    expect(((await (await owner('/alerts')).json()) as { home: unknown }).home).toBeNull();
  });
});
