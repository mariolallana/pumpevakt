// Web Push (RFC 8030) to the owner's installed web app: VAPID auth (RFC 8292) and aes128gcm payload
// encryption (RFC 8291), WebCrypto only, no dependency. Replaces Telegram as the alarm channel
// (owner decision 2026-10-24, docs/product-direction-2026-10.md).
const enc = new TextEncoder();

export const b64u = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s: string): Uint8Array {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  },
};

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** One HKDF extract+expand (RFC 5869), as RFC 8291 §3.3–3.4 uses it. */
export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * ECDH derive params. workers-types spell the standard `public` member `$public` (a reserved word in their
 * generator); workerd itself takes the standard name (checked in Miniflare 2026-10-24).
 */
export const ecdhParams = (pub: CryptoKey) => ({ name: 'ECDH', public: pub }) as unknown as SubtleCryptoDeriveKeyAlgorithm;

export interface Subscription {
  endpoint: string;
  /** Browser's ECDH P-256 public key, base64url (65 bytes uncompressed). */
  p256dh: string;
  /** Browser's 16-byte auth secret, base64url. */
  auth: string;
}

export interface Vapid {
  /** Application server public key, base64url (65 bytes uncompressed); the browser subscribes with it. */
  publicKey: string;
  privateJwk: JsonWebKey;
  /** Contact for push services: a mailto: or https: URL. */
  subject: string;
}

/** RFC 8291 aes128gcm body: salt(16) | rs(4) | idlen(1) | as_public(65) | ciphertext. */
export async function encryptPayload(payload: Uint8Array, sub: Subscription): Promise<Uint8Array> {
  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPub = new Uint8Array((await crypto.subtle.exportKey('raw', as.publicKey)) as ArrayBuffer);
  const uaPubBytes = b64u.decode(sub.p256dh);
  const uaPub = await crypto.subtle.importKey('raw', uaPubBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams(uaPub), as.privateKey, 256));
  const ikm = await hkdf(b64u.decode(sub.auth), ecdh, concat(enc.encode('WebPush: info\0'), uaPubBytes, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the payload, then the 0x02 "last record" delimiter.
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(16 + 4 + 1 + asPub.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPub.length;
  header.set(asPub, 21);
  return concat(header, ct);
}

/** `Authorization` header value: a 12 h ES256 JWT for the push service's origin, plus our public key. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, nowMs: number): Promise<string> {
  const part = (o: unknown) => b64u.encode(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: vapid.subject })}`;
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64u.encode(sig)}, k=${vapid.publicKey}`;
}

export interface Note {
  title: string;
  body: string;
  /** Page to open on tap. */
  url?: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

/** Send one notification. 'gone' (404/410) means the browser dropped the subscription: delete it. */
export async function sendPush(sub: Subscription, note: Note, vapid: Vapid, fetchFn: typeof fetch = fetch, nowMs = Date.now()): Promise<PushOutcome> {
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(note)), sub);
    const res = await fetchFn(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(sub.endpoint, vapid, nowMs),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(12 * 3600),
        urgency: 'normal',
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) {
      console.error(`push ${new URL(sub.endpoint).host} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.error(`push failed: ${e instanceof Error ? e.message : String(e)}`);
    return 'failed';
  }
}
