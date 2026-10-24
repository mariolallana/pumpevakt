// Single-user settings from env vars (docs/03 · Config). Phase 1 only reads them; Phases 2–3 use them.
import type { Env, Fuel } from './types';
import { FUELS } from './types';

export type Sensitivity = 'relaxed' | 'normal' | 'eager';

export interface Config {
  home: { lat: number; lon: number };
  fuel: Fuel;
  tankL: number;
  consumptionL100: number;
  sensitivity: Sensitivity;
  quietHours: { from: number; to: number }; // Europe/Oslo hours, e.g. 22 → 7
  allowedChatIds: number[];
}

export const DEFAULTS: Config = {
  home: { lat: 59.93, lon: 10.8 },
  fuel: 'diesel',
  tankL: 50,
  consumptionL100: 6.5,
  sensitivity: 'normal',
  quietHours: { from: 22, to: 7 },
  allowedChatIds: [],
};

const numOr = (v: string | undefined, d: number): number => {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Parse env vars with safe fallbacks to DEFAULTS (a bad value never crashes a cron run). */
export function loadConfig(env: Partial<Env>): Config {
  const fuel = FUELS.includes(env.FUEL as Fuel) ? (env.FUEL as Fuel) : DEFAULTS.fuel;
  const sens = (['relaxed', 'normal', 'eager'] as const).find((s) => s === env.SENSITIVITY) ?? DEFAULTS.sensitivity;
  const qh = /^(\d{1,2})-(\d{1,2})$/.exec(env.QUIET_HOURS ?? '');
  const quietHours = qh && Number(qh[1]) < 24 && Number(qh[2]) < 24 ? { from: Number(qh[1]), to: Number(qh[2]) } : DEFAULTS.quietHours;
  const allowedChatIds = (env.ALLOWED_CHAT_IDS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n !== 0);
  return {
    home: { lat: numOr(env.HOME_LAT, DEFAULTS.home.lat), lon: numOr(env.HOME_LON, DEFAULTS.home.lon) },
    fuel,
    tankL: numOr(env.TANK_L, DEFAULTS.tankL),
    consumptionL100: numOr(env.CONSUMPTION_L100, DEFAULTS.consumptionL100),
    sensitivity: sens,
    quietHours,
    allowedChatIds,
  };
}
