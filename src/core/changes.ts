// Change-only price storage (docs/03 · prices): pure decision of which observations to append.
import type { StationObs } from '../types';

export interface Latest {
  price: number;
  observedAt: string;
}

/** Observations whose price or observedAt differs from the latest stored row for the same (station, fuel). */
export function changedObs(obs: StationObs[], latest: Map<string, Latest>, key = (o: StationObs) => `${o.station.id}|${o.fuel}`): StationObs[] {
  return obs.filter((o) => {
    const prev = latest.get(key(o));
    return !prev || prev.price !== o.price || prev.observedAt !== o.observedAt;
  });
}

/** Unique stations from observations (first occurrence wins). */
export function uniqueStations(obs: StationObs[]): StationObs['station'][] {
  const m = new Map<string, StationObs['station']>();
  for (const o of obs) if (!m.has(o.station.id)) m.set(o.station.id, o.station);
  return [...m.values()];
}
