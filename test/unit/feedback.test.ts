import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFeedback } from '../../src/feedback';
import { handleFetch } from '../../src/routes';
import { createTestDb, rows } from './helpers';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb(); // applies every migration, 0002_feedback included
});
afterAll(() => t.dispose());

const post = (body: unknown, key?: string) =>
  handleFetch(
    new Request('https://x/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'X-Feedback-Key': key } : {}) },
      body: JSON.stringify(body),
    }),
    { ...t.env, FEEDBACK_KEY: 'k3y' },
  );

describe('parseFeedback', () => {
  it('validates verdict, price range and note text', () => {
    expect(parseFeedback({ verdict: 'meh' })).toMatch(/verdict/);
    expect(parseFeedback({ verdict: 'wrong', actualPrice: 2.19 })).toMatch(/actualPrice/);
    expect(parseFeedback({ verdict: 'note', note: '  ' })).toMatch(/note/);
    expect(parseFeedback({ verdict: 'wrong', actualPrice: 29.18, stationId: 'x' })).toMatchObject({ verdict: 'wrong', actualPrice: 29.18 });
  });
});

describe('POST /api/feedback', () => {
  it('rejects a missing or wrong key', async () => {
    expect((await post({ verdict: 'ok' })).status).toBe(401);
    expect((await post({ verdict: 'ok' }, 'nope')).status).toBe(401);
  });

  it('stores a wrong-price report with the app price and the sign price', async () => {
    const res = await post(
      { verdict: 'wrong', stationId: 's1', stationName: 'Kiellands Plass', fuel: 'diesel', appPrice: 25.1, appObservedAt: '2026-10-24T10:38:00.000Z', actualPrice: 29.18, note: 'sign says 29.18' },
      'k3y',
    );
    expect(res.status).toBe(201);
    const [r] = await rows<{ verdict: string; app_price: number; actual_price: number }>(t.db, 'SELECT * FROM feedback');
    expect(r).toMatchObject({ verdict: 'wrong', app_price: 25.1, actual_price: 29.18 });
  });

  it('rejects GET and bad bodies', async () => {
    const get = await handleFetch(new Request('https://x/api/feedback'), { ...t.env, FEEDBACK_KEY: 'k3y' });
    expect(get.status).toBe(405);
    expect((await post({ verdict: 'note' }, 'k3y')).status).toBe(400);
  });
});
