// POST /api/feedback: user-test notes from the web page (docs/spec-flaws.md F21).
// Guarded by the FEEDBACK_KEY secret (sent as X-Feedback-Key) so only the owner can write.
import type { Env } from './types';

export interface FeedbackInput {
  verdict: 'ok' | 'wrong' | 'note';
  stationId?: string | null;
  stationName?: string | null;
  fuel?: string | null;
  appPrice?: number | null;
  appObservedAt?: string | null;
  actualPrice?: number | null;
  note?: string | null;
  lat?: number | null;
  lon?: number | null;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x: unknown, max: number): string | null => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);

/** Validate an untrusted body. Returns the cleaned input or an error message. */
export function parseFeedback(body: unknown): FeedbackInput | string {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (b.verdict !== 'ok' && b.verdict !== 'wrong' && b.verdict !== 'note') return 'verdict must be ok, wrong or note';
  const actual = num(b.actualPrice);
  if (actual !== null && (actual < 5 || actual > 60)) return 'actualPrice must be between 5 and 60';
  const note = str(b.note, 1000);
  if (b.verdict === 'note' && !note) return 'a note needs text';
  return {
    verdict: b.verdict,
    stationId: str(b.stationId, 100),
    stationName: str(b.stationName, 200),
    fuel: str(b.fuel, 20),
    appPrice: num(b.appPrice),
    appObservedAt: str(b.appObservedAt, 40),
    actualPrice: actual,
    note,
    lat: num(b.lat),
    lon: num(b.lon),
  };
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function handleFeedback(request: Request, env: Env, now = new Date()): Promise<Response> {
  if (!env.FEEDBACK_KEY || request.headers.get('X-Feedback-Key') !== env.FEEDBACK_KEY) {
    return json({ error: { code: 'UNAUTHORIZED', message: 'missing or wrong feedback key' } }, 401);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: { code: 'BAD_INPUT', message: 'body must be JSON' } }, 400);
  }
  const f = parseFeedback(body);
  if (typeof f === 'string') return json({ error: { code: 'BAD_INPUT', message: f } }, 400);
  await env.DB.prepare(
    `INSERT INTO feedback (created_at, verdict, station_id, station_name, fuel, app_price, app_observed_at, actual_price, note, lat, lon)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(now.toISOString(), f.verdict, f.stationId ?? null, f.stationName ?? null, f.fuel ?? null, f.appPrice ?? null,
      f.appObservedAt ?? null, f.actualPrice ?? null, f.note ?? null, f.lat ?? null, f.lon ?? null)
    .run();
  return json({ ok: true }, 201);
}
