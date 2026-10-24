// QA helpers: black-box fixtures and a fake fetch. Only contract types are imported from src/.
import type { Station, StationObs, Fuel } from '../../src/types';
import realStations from './fixtures/drivstoffapp-oslo-centre.json';
import adversarialStations from './fixtures/drivstoffapp-adversarial.json';
import fredCsv from './fixtures/fred-ddfuelnyh.csv?raw';
import fredAdversarialCsv from './fixtures/fred-adversarial.csv?raw';
import fredLegacyCsv from './fixtures/fred-legacy-header.csv?raw';
import nbCsv from './fixtures/norgesbank-usdnok.csv?raw';

export const fixtures = {
  realStations: realStations as unknown[],
  adversarialStations: adversarialStations as unknown[],
  fredCsv,
  fredAdversarialCsv,
  fredLegacyCsv,
  nbCsv,
};

export const OSLO = { lat: 59.9111, lon: 10.7528 };
export const KM_PER_DEG_LAT = 111.195; // haversine, R = 6371 km
export const PROJECT_UA = 'pumpevakt/1.0 (github.com/mariolallana/pumpevakt)';

/** Point `km` north of Oslo S. */
export function northOf(km: number): { lat: number; lon: number } {
  return { lat: OSLO.lat + km / KM_PER_DEG_LAT, lon: OSLO.lon };
}

export function hoursBefore(now: Date, h: number): string {
  return new Date(now.getTime() - h * 3600_000).toISOString();
}

let seq = 0;
export function mkStation(over: Partial<Station> = {}): Station {
  seq++;
  return {
    id: `qa${String(seq).padStart(6, '0')}`,
    name: `QA ${seq}`,
    brand: 'QA',
    address: 'Testveien 1',
    lat: OSLO.lat + 0.001 * (seq % 10),
    lon: OSLO.lon + 0.001 * (seq % 7),
    ...over,
  };
}

export function mkObs(price: number, observedAt: string, over: { fuel?: Fuel; station?: Partial<Station> } = {}): StationObs {
  return { station: mkStation(over.station), fuel: over.fuel ?? 'diesel', price, observedAt };
}

/** A raw drivstoffapp station object in the live shape (docs/01 §2). */
export function rawStation(
  id: string,
  lat: number,
  lon: number,
  prices: Partial<Record<'diesel_price' | 'gasoline_price' | 'octane_price' | 'hvo100_price' | 'fd_price', number | null>>,
  updatedAt: string, // 'YYYY-MM-DD HH:MM:SS.000Z' like the live API
) {
  const p: Record<string, unknown> = {
    gasoline_price: null, octane_price: null, diesel_price: null, fd_price: null, hvo100_price: null, e10_price: null,
    ...prices,
  };
  const upd: Record<string, string> = {};
  for (const [k, v] of Object.entries(prices)) if (v != null) upd[k] = updatedAt;
  p.updated_at = upd;
  return {
    id, name: `Synthetic ${id}`, brand: 'QA',
    location: { latitude: lat, longitude: lon, address: 'Testveien 2, 0150 Oslo', country: null },
    prices: p, station_type: 'road', is_active: true, closed: false,
  };
}

/** API-style timestamp ('2026-10-24 08:00:00.000Z') for an instant. */
export function apiTs(d: Date): string {
  return d.toISOString().replace('T', ' ');
}

/** N synthetic stations within ~3 km of Oslo S, all with fresh diesel prices. */
export function syntheticFreshStations(n: number, now: Date, basePrice = 24, idPrefix = 'syn') {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(rawStation(`${idPrefix}${String(i).padStart(4, '0')}`, OSLO.lat + 0.002 * (i % 10), OSLO.lon + 0.003 * Math.floor(i / 10),
      { diesel_price: +(basePrice + i * 0.01).toFixed(2), gasoline_price: 26 }, apiTs(new Date(now.getTime() - 30 * 60_000))));
  }
  return out;
}

export interface RecordedCall { url: URL; headers: Headers; signal: AbortSignal | null | undefined; method: string }

function toCall(input: RequestInfo | URL, init?: RequestInit): RecordedCall {
  const isReq = typeof Request !== 'undefined' && input instanceof Request;
  const url = new URL(isReq ? (input as Request).url : String(input));
  const headers = new Headers(isReq ? (input as Request).headers : undefined);
  new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
  return { url, headers, signal: init?.signal ?? (isReq ? (input as Request).signal : undefined), method: init?.method ?? (isReq ? (input as Request).method : 'GET') };
}

/** Fake fetch routing by URL. `router` returns a Response, or undefined → 404. */
export function fakeFetch(router: (call: RecordedCall, idx: number) => Response | Promise<Response> | undefined) {
  const calls: RecordedCall[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = toCall(input, init);
    calls.push(call);
    const r = await router(call, calls.length - 1);
    return r ?? new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const text = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/csv' } });

/** Standard router: drivstoffapp centre i → stationsByCentre[i]; FRED → fred; Norges Bank → nb. */
export function sourcesRouter(opts: {
  centres: { lat: number; lon: number }[];
  stationsByCentre: unknown[][];
  fred?: string;
  nb?: string;
  failDrivstoffapp?: boolean;
  failMarket?: boolean;
}) {
  return (call: RecordedCall) => {
    const host = call.url.hostname;
    if (host === 'backend.drivstoffapp.no') {
      if (opts.failDrivstoffapp) return new Response('boom', { status: 503 });
      const lat = Number(call.url.searchParams.get('lat'));
      const lng = Number(call.url.searchParams.get('lng'));
      let best = 0, bestD = Infinity;
      opts.centres.forEach((c, i) => {
        const d = Math.abs(c.lat - lat) + Math.abs(c.lon - lng);
        if (d < bestD) { bestD = d; best = i; }
      });
      return json(opts.stationsByCentre[best] ?? []);
    }
    if (host === 'fred.stlouisfed.org') return opts.failMarket ? text('err', 500) : text(opts.fred ?? fixtures.fredCsv);
    if (host === 'data.norges-bank.no') return opts.failMarket ? text('err', 500) : text(opts.nb ?? fixtures.nbCsv);
    return undefined;
  };
}

export const NOW = new Date('2026-10-24T10:00:00.000Z');
