// Unit-test helpers: a real local D1 (Miniflare, in-memory) with migration 0001 applied, and a fake fetch.
import { Miniflare } from 'miniflare';
import migrationSql from '../../db/migrations/0001_init.sql?raw';
import type { Env, Station, StationObs, Fuel } from '../../src/types';

export async function createTestDb(): Promise<{ env: Env; db: D1Database; dispose: () => Promise<void>; reset: () => Promise<void> }> {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("") } }', d1Databases: ['DB'] });
  const db = (await mf.getD1Database('DB')) as unknown as D1Database;
  const stmts = migrationSql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of stmts) await db.prepare(s).run();
  return {
    env: { DB: db },
    db,
    dispose: () => mf.dispose(),
    reset: async () => {
      for (const t of ['prices', 'stations', 'market_daily', 'runs', 'alerts', 'fillups', 'settings']) await db.prepare(`DELETE FROM ${t}`).run();
    },
  };
}

export async function rows<T = Record<string, unknown>>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...binds).all<T>()).results;
}

export interface Call {
  url: string;
  headers: Headers;
}

/** fetch stub: `route(url)` returns the body (object → JSON, string → text) or a Response; records every call. */
export function fakeFetch(route: (url: string) => unknown): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, headers: new Headers(init?.headers) });
    const body = route(url);
    if (body instanceof Response) return body;
    if (body instanceof Error) throw body;
    if (typeof body === 'string') return new Response(body, { status: 200 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

export const apiTs = (d: Date): string => d.toISOString().replace('T', ' ');

/** A raw drivstoffapp station in the live response shape (docs/01 §2). */
export function rawStation(id: string, lat: number, lon: number, prices: Record<string, number | null>, updatedAt: string, extra: Record<string, unknown> = {}) {
  const updated: Record<string, string> = {};
  for (const [k, v] of Object.entries(prices)) if (v !== null) updated[k] = updatedAt;
  return {
    id,
    name: `Test ${id}`,
    brand: 'Test',
    location: { latitude: lat, longitude: lon, address: 'Testveien 1, 0150 Oslo', country: null },
    prices: { gasoline_price: null, octane_price: null, diesel_price: null, fd_price: null, hvo100_price: null, e10_price: null, ...prices, updated_at: updated },
    ...extra,
  };
}

/** n stations near Oslo S with fresh diesel prices: base, base+0.1, ... */
export function freshStations(n: number, now: Date, base = 24, prefix = 's') {
  return Array.from({ length: n }, (_, i) =>
    rawStation(`${prefix}${i}`, 59.9111 + 0.001 * i, 10.7528, { diesel_price: Math.round((base + 0.1 * i) * 100) / 100 }, apiTs(new Date(now.getTime() - 3600_000))),
  );
}

let seq = 0;
export function obs(price: number, observedAt: string, over: { fuel?: Fuel; station?: Partial<Station> } = {}): StationObs {
  seq++;
  return {
    station: { id: `t${seq}`, name: `T${seq}`, brand: 'T', address: '', lat: 59.9111, lon: 10.7528, ...over.station },
    fuel: over.fuel ?? 'diesel',
    price,
    observedAt,
  };
}
