// Shared types (docs/05 §4, docs/phase-1-contract.md).

export type Fuel = 'diesel' | 'petrol95' | 'petrol98' | 'hvo100';

export const FUELS: readonly Fuel[] = ['diesel', 'petrol95', 'petrol98', 'hvo100'];

export interface Station {
  id: string;
  name: string;
  brand: string;
  address: string;
  lat: number;
  lon: number;
}

/** One observed price. `observedAt` is ISO-8601 UTC ('...Z'): when the source saw the price, not when we fetched it. */
export interface StationObs {
  station: Station;
  fuel: Fuel;
  price: number; // NOK/L incl. VAT
  observedAt: string;
}

/** One value per day per series. `day` is 'YYYY-MM-DD'. */
export interface MarketPoint {
  day: string;
  series: string;
  value: number;
}

export interface Env {
  DB: D1Database;
  HOME_LAT?: string;
  HOME_LON?: string;
  FUEL?: string;
  TANK_L?: string;
  CONSUMPTION_L100?: string;
  SENSITIVITY?: string;
  QUIET_HOURS?: string;
  ALLOWED_CHAT_IDS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Owner secret for POST /api/feedback and /api/owner/* (wrangler secret put FEEDBACK_KEY). */
  FEEDBACK_KEY?: string;
  /** Web push: public key (var, base64url), private key (secret, JWK JSON), contact URL (var). */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
}

/** Project User-Agent sent to every source (docs/01 §2). */
export const USER_AGENT = 'pumpevakt/1.0 (github.com/mariolallana/pumpevakt)';

/** Per-request timeout for every source (docs/05 §4). */
export const FETCH_TIMEOUT_MS = 15_000;
