// drivstoffapp.no adapter (docs/01 §2). Pure fetch-and-map, no DB access.
import { FETCH_TIMEOUT_MS, USER_AGENT, type Fuel, type Station, type StationObs } from '../types';

export const BASE_URL = 'https://backend.drivstoffapp.no/stations/fuel/nearby';
export const RADIUS_KM = 12;
export const LIMIT = 100; // API maximum

/** Three query centres (Oslo west, centre, east), 12 km radius each. `limit` caps at 100, hence three calls. */
export const CENTRES: { lat: number; lon: number }[] = [
  { lat: 59.92, lon: 10.56 }, // west: Lysaker / Bærum
  { lat: 59.9111, lon: 10.7528 }, // centre: Oslo S
  { lat: 59.93, lon: 10.95 }, // east: Furuset / Lørenskog
];

/** Source field → our fuel. `fd_price` (tax-free diesel) and `e10_price` are deliberately absent. */
const FIELD_TO_FUEL: [field: string, fuel: Fuel][] = [
  ['diesel_price', 'diesel'],
  ['gasoline_price', 'petrol95'],
  ['octane_price', 'petrol98'],
  ['hvo100_price', 'hvo100'],
];

export const MIN_PRICE = 5;
export const MAX_PRICE = 60;

export function nearbyUrl(c: { lat: number; lon: number }): string {
  return `${BASE_URL}?lat=${c.lat}&lng=${c.lon}&radius=${RADIUS_KM}&limit=${LIMIT}&include_no_price=false`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** "2026-10-24 07:26:46.000Z" → "2026-10-24T07:26:46.000Z". Strings without a zone are taken as UTC. null if unparseable. */
export function toIsoUtc(s: unknown): string | null {
  if (typeof s !== 'string' || s.trim() === '') return null;
  let t = s.trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(t)) t += 'Z';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Map one /stations/fuel/nearby response to observations. Pure.
 * Skips: fd_price, null/non-numeric prices, prices outside 5–60 NOK/L, missing/invalid per-fuel updated_at,
 * stations without id or coordinates. A non-array body throws: a format change must fail the run, not
 * look like an empty success.
 */
export function mapStations(json: unknown): StationObs[] {
  if (!Array.isArray(json)) throw new Error(`drivstoffapp: expected a JSON array, got ${json === null ? 'null' : typeof json}`);
  const out: StationObs[] = [];
  for (const s of json) {
    if (!isObj(s) || typeof s.id !== 'string' || s.id === '') continue;
    const loc = isObj(s.location) ? s.location : {};
    const lat = loc.latitude;
    const lon = loc.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const prices = isObj(s.prices) ? s.prices : {};
    const updated = isObj(prices.updated_at) ? prices.updated_at : {};
    const chain = isObj(s.expand) && isObj(s.expand.chain) ? s.expand.chain : {};
    const station: Station = {
      id: s.id,
      name: str(s.name),
      brand: str(s.brand) || str(chain.name),
      address: str(loc.address),
      lat,
      lon,
    };
    for (const [field, fuel] of FIELD_TO_FUEL) {
      const price = prices[field];
      if (typeof price !== 'number' || !Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) continue;
      const observedAt = toIsoUtc(updated[field]);
      if (!observedAt) continue;
      out.push({ station, fuel, price, observedAt });
    }
  }
  return out;
}

/** Merge lists, one observation per station.id + fuel. On duplicates the newest observedAt wins (first seen on ties). */
export function dedupeObs(lists: StationObs[][]): StationObs[] {
  const byKey = new Map<string, StationObs>();
  for (const list of lists) {
    for (const o of list) {
      const key = `${o.station.id}|${o.fuel}`;
      const prev = byKey.get(key);
      if (!prev || o.observedAt > prev.observedAt) byKey.set(key, o);
    }
  }
  return [...byKey.values()];
}

/**
 * Fetch all three centres (in parallel, 15 s timeout each) and return deduped observations.
 * Throws if any call fails or a non-empty response maps to nothing (format change). All-empty → [].
 * A caller-supplied `signal` is combined with the 15 s timeout (whichever aborts first).
 */
export async function fetchDrivstoffapp(fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<StationObs[]> {
  const lists = await Promise.all(
    CENTRES.map(async (c) => {
      const res = await fetchFn(nearbyUrl(c), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`drivstoffapp HTTP ${res.status} for centre ${c.lat},${c.lon}`);
      const body: unknown = await res.json();
      const mapped = mapStations(body);
      // Stations came back but nothing mapped: the field names changed. Fail loudly (docs/09).
      if ((body as unknown[]).length > 0 && mapped.length === 0) {
        throw new Error(`drivstoffapp: ${(body as unknown[]).length} stations but no mappable prices for centre ${c.lat},${c.lon} (format change?)`);
      }
      return mapped;
    }),
  );
  return dedupeObs(lists);
}
