// Owner alarms client: push subscription and the /api/owner/* calls (src/owner.ts).

export interface OwnerAlert {
  id: number;
  kind: 'market_drop' | 'outlier' | 'system';
  status: 'pending' | 'sent' | 'shadow' | 'dropped';
  createdAt: string;
  sentAt: string | null;
  feedback: 'up' | 'down' | null;
  title: string;
  body: string;
}

export interface AlertsResponse {
  shadow: boolean;
  mutedUntil: string | null;
  alerts: OwnerAlert[];
}

export async function ownerJson<T>(key: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/owner${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'X-Feedback-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export async function pushState(): Promise<PushState> {
  // iPhone/iPad only allow web push from an app added to the Home Screen (iOS 16.4+).
  if (isIos() && !standalone()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Ask permission (must run from a tap), subscribe this browser and register it with the Worker. */
export async function enablePush(key: string): Promise<void> {
  const { publicKey } = await ownerJson<{ publicKey: string | null }>(key, '/push');
  if (!publicKey) throw new Error('push is not configured on the server');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('notifications were not allowed');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await ownerJson(key, '/subscribe', sub.toJSON());
}

export async function disablePush(key: string): Promise<void> {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  await ownerJson(key, '/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
