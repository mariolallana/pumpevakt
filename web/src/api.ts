// Types mirror docs/web-v1-contract.md "Response shapes" (the Worker's src/ types aren't imported to keep
// the web build free of Workers types).

export type Fuel = 'diesel' | 'petrol95' | 'petrol98' | 'hvo100';

export const FUEL_LABELS: Record<Fuel, string> = {
  diesel: 'Diesel',
  petrol95: 'Petrol 95',
  petrol98: 'Petrol 98',
  hvo100: 'HVO100',
};

export interface StationItem {
  id: string;
  name: string;
  brand: string;
  address: string;
  lat: number;
  lon: number;
  price: number;
  observedAt: string;
  ageMinutes: number;
  stale: boolean;
  unconfirmed: boolean;
  distanceKm: number;
  netSavingNok: number | null;
}

export interface StationsResponse {
  fuel: Fuel;
  origin: { lat: number; lon: number };
  radiusKm: number;
  refPrice: number | null;
  generatedAt: string;
  coverage: { current: number; hiddenOutdated: number; jumpDetected: boolean };
  stations: StationItem[];
}

export interface MarketResponse {
  days: number;
  osloDieselMedian: Array<{ day: string; value: number }>;
  wdi: Array<{ day: string; value: number }>;
  latest: { level: number | null; at: string | null; nFresh: number | null };
}

interface JobHealth {
  lastOk: string | null;
  consecutiveFailures: number;
}
export interface HealthResponse {
  jobs: { prices: JobHealth; market: JobHealth };
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal, headers: { accept: 'application/json' } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) msg = body.error.message;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function fetchStations(
  q: { fuel: Fuel; radiusKm: number; origin: { lat: number; lon: number } | null },
  signal?: AbortSignal,
): Promise<StationsResponse> {
  const p = new URLSearchParams({ fuel: q.fuel, radius_km: String(q.radiusKm) });
  // No origin → the Worker defaults to Oslo S (never HOME; docs/spec-flaws-impl.md IMPL-W11).
  if (q.origin) {
    p.set('lat', q.origin.lat.toFixed(5));
    p.set('lon', q.origin.lon.toFixed(5));
  }
  return getJson(`/api/stations?${p}`, signal);
}

export const fetchMarket = (signal?: AbortSignal) => getJson<MarketResponse>('/api/market?days=30', signal);
export const fetchHealth = (signal?: AbortSignal) => getJson<HealthResponse>('/health', signal);

/** Source-down rule from the contract: consecutiveFailures ≥ 2 or lastOk older than 2 h (or never). */
export function sourceDown(h: HealthResponse, now = Date.now()): boolean {
  const p = h.jobs.prices;
  if (p.consecutiveFailures >= 2) return true;
  if (!p.lastOk) return true;
  return now - Date.parse(p.lastOk) > 2 * 3_600_000;
}
