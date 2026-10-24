import { describe, expect, it } from 'vitest';
import { b64u, concat, ecdhParams, encryptPayload, hkdf, sendPush, vapidAuthorization, type Subscription, type Vapid } from '../../src/push';

const enc = new TextEncoder();

/** A browser's side: its ECDH key pair and auth secret, and RFC 8291 decryption. */
async function fakeBrowser() {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub: Subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: b64u.encode(pub), auth: b64u.encode(auth) };
  async function decrypt(body: Uint8Array): Promise<string> {
    const salt = body.slice(0, 16);
    const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
    const idlen = body[20]!;
    const asPub = body.slice(21, 21 + idlen);
    expect(rs).toBe(4096);
    const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams(asKey), keys.privateKey, 256));
    const ikm = await hkdf(auth, ecdh, concat(enc.encode('WebPush: info\0'), pub, asPub), 32);
    const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
    expect(plain.at(-1)).toBe(2); // last-record delimiter
    return new TextDecoder().decode(plain.slice(0, -1));
  }
  return { sub, decrypt };
}

async function vapidKeys(): Promise<{ vapid: Vapid; publicKey: CryptoKey }> {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', k.publicKey)) as ArrayBuffer);
  return {
    vapid: { publicKey: b64u.encode(raw), privateJwk: (await crypto.subtle.exportKey('jwk', k.privateKey)) as JsonWebKey, subject: 'https://github.com/mariolallana/pumpevakt' },
    publicKey: k.publicKey,
  };
}

describe('b64u', () => {
  it('round-trips without padding', () => {
    const bytes = Uint8Array.from([0, 251, 255, 62, 63, 1]);
    expect(b64u.encode(bytes)).not.toMatch(/[=+/]/);
    expect(b64u.decode(b64u.encode(bytes))).toEqual(bytes);
  });
});

describe('encryptPayload (RFC 8291)', () => {
  it('the browser can decrypt it', async () => {
    const b = await fakeBrowser();
    const msg = JSON.stringify({ title: '⚠️ Price updates failing', body: 'Øre and æøå survive' });
    expect(await b.decrypt(await encryptPayload(enc.encode(msg), b.sub))).toBe(msg);
  });
});

describe('vapidAuthorization (RFC 8292)', () => {
  it('a valid ES256 JWT for the push origin, expiring in 12 h, with our key', async () => {
    const { vapid, publicKey } = await vapidKeys();
    const now = Date.parse('2026-10-24T20:00:00Z');
    const h = await vapidAuthorization('https://web.push.apple.com/QGx1/abc', vapid, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
    expect(m).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(b64u.decode(m[2]!)))).toEqual({
      aud: 'https://web.push.apple.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://github.com/mariolallana/pumpevakt',
    });
    expect(m[4]).toBe(vapid.publicKey);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64u.decode(m[3]!), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});

describe('sendPush', () => {
  it('POSTs an encrypted body with the push headers; 201 sent, 410 gone, 500 failed', async () => {
    const { vapid } = await vapidKeys();
    const b = await fakeBrowser();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 201;
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('', { status });
    }) as unknown as typeof fetch;
    expect(await sendPush(b.sub, { title: 'T', body: 'B' }, vapid, fetchFn)).toBe('sent');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe(b.sub.endpoint);
    expect(h['content-encoding']).toBe('aes128gcm');
    expect(h.ttl).toBe('43200');
    expect(h.authorization).toMatch(/^vapid t=/);
    expect(JSON.parse(await b.decrypt(calls[0]!.init.body as Uint8Array))).toEqual({ title: 'T', body: 'B' });
    status = 410;
    expect(await sendPush(b.sub, { title: 'T', body: 'B' }, vapid, fetchFn)).toBe('gone');
    status = 500;
    expect(await sendPush(b.sub, { title: 'T', body: 'B' }, vapid, fetchFn)).toBe('failed');
  });
});
