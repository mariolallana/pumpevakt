// Owner-only user-test feedback (docs/spec-flaws.md F21). The key comes once via ?key=… and is kept
// in localStorage; without it no feedback UI is shown.
const STORE = 'pumpevakt.feedbackKey';

export function feedbackKey(): string | null {
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('key');
    if (fromUrl) {
      localStorage.setItem(STORE, fromUrl);
      url.searchParams.delete('key');
      window.history.replaceState(null, '', url.toString());
      return fromUrl;
    }
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

export interface FeedbackBody {
  verdict: 'ok' | 'wrong' | 'note';
  stationId?: string;
  stationName?: string;
  fuel?: string;
  appPrice?: number;
  appObservedAt?: string;
  actualPrice?: number;
  note?: string;
  lat?: number;
  lon?: number;
}

export async function sendFeedback(key: string, body: FeedbackBody): Promise<void> {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Feedback-Key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().then((j: { error?: { message?: string } }) => j.error?.message).catch(() => null);
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
}
