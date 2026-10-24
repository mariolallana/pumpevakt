// Push delivery rules (docs/04 §4): shadow mode for price alarms, quiet hours 22–07 Oslo, at most 3 pushes
// a day, mute. Held alerts are retried each run and dropped once stale. System (health) alerts skip shadow
// mode and mute, so a dead data source is never silent; they still respect quiet hours and the cap.
import { osloHour } from './time';

export type AlertKind = 'market_drop' | 'outlier' | 'system';
export type Decision = 'send' | 'hold' | 'shadow' | 'drop';

export const QUIET_FROM_H = 22;
export const QUIET_TO_H = 7;
export const DAILY_CAP = 3;
export const HOLD_MAX_H = 12; // a held alert older than this is dropped, not sent late

export const inQuietHours = (now: Date): boolean => {
  const h = osloHour(now);
  return h >= QUIET_FROM_H || h < QUIET_TO_H;
};

export interface DeliveryContext {
  now: Date;
  shadow: boolean;
  mutedUntil: string | null;
  /** Pushes already sent this Oslo day. */
  sentToday: number;
}

export function decide(alert: { kind: AlertKind; createdAt: string }, ctx: DeliveryContext): Decision {
  const price = alert.kind !== 'system';
  if (price && ctx.shadow) return 'shadow';
  if (ctx.now.getTime() - Date.parse(alert.createdAt) > HOLD_MAX_H * 3_600_000) return 'drop';
  if (inQuietHours(ctx.now)) return 'hold';
  if (price && ctx.mutedUntil && Date.parse(ctx.mutedUntil) > ctx.now.getTime()) return 'hold';
  if (ctx.sentToday >= DAILY_CAP) return 'hold';
  return 'send';
}
