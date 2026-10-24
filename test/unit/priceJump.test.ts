import { describe, expect, it } from 'vitest';
import { isOutdated, recentMedian } from '../../src/core/priceJump';
import { osloLevel } from '../../src/core/osloLevel';
import { buildStations } from '../../src/core/stationList';
import type { StationObs } from '../../src/types';

const now = new Date('2026-10-24T15:00:00Z');
const minsAgo = (m: number) => now.getTime() - m * 60_000;

describe('priceJump', () => {
  const recent = Array.from({ length: 12 }, (_, i) => ({ price: 27.5 + (i % 3) * 0.1, t: minsAgo(10 + i * 5) }));

  it('recentMedian needs at least 10 prices from the last 2 h', () => {
    expect(recentMedian(recent.slice(0, 9), now.getTime())).toBeNull();
    expect(recentMedian(recent, now.getTime())).toBeCloseTo(27.6, 5);
  });

  it('flags old prices ≥ 1 kr below the recent median, keeps recent cheap ones', () => {
    const med = recentMedian(recent, now.getTime());
    expect(isOutdated({ price: 24.4, t: minsAgo(200) }, now.getTime(), med)).toBe(true); // pre-jump
    expect(isOutdated({ price: 22.8, t: minsAgo(27) }, now.getTime(), med)).toBe(false); // recent bargain
    expect(isOutdated({ price: 27.0, t: minsAgo(200) }, now.getTime(), med)).toBe(false); // old but in line
    expect(isOutdated({ price: 20, t: minsAgo(200) }, now.getTime(), null)).toBe(false); // no recent data
  });
});

const station = (i: number) => ({ id: `s${i}`, name: `S${i}`, brand: 'B', address: '', lat: 59.91 + (i % 40) * 0.0005, lon: 10.75 });

describe('jump-aware Oslo level and station list (2026-10-24 scenario)', () => {
  // 25 pre-jump prices at ~24.4 (3–5 h old) + 15 post-jump at ~27.5 (≤ 2 h) + 1 recent bargain at 22.8
  const pre = Array.from({ length: 25 }, (_, i) => ({ s: station(i), price: 24.4, t: minsAgo(180 + i * 5) }));
  const post = Array.from({ length: 15 }, (_, i) => ({ s: station(100 + i), price: 27.5, t: minsAgo(20 + i * 5) }));
  const bargain = { s: station(200), price: 22.8, t: minsAgo(27) };
  const all = [...pre, ...post, bargain];

  it('osloLevel ignores pre-jump prices', () => {
    const obs: StationObs[] = all.map((x) => ({ station: x.s, fuel: 'diesel', price: x.price, observedAt: new Date(x.t).toISOString() }));
    const lvl = osloLevel(obs, now)!;
    expect(lvl.nFresh).toBe(41);
    expect(lvl.median).toBe(27.5);
  });

  it('station list ranks the recent bargain first and sinks pre-jump prices as stale', () => {
    const rows = all.map((x) => ({ ...x.s, price: x.price, observedAt: new Date(x.t).toISOString() }));
    const res = buildStations(rows, { fuel: 'diesel', origin: { lat: 59.9111, lon: 10.7528 }, radiusKm: 10, now, osloLevel: 27.5, tankL: 50, consumptionL100: 6.5 });
    expect(res.stations[0].id).toBe('s200');
    expect(res.stations.filter((s) => s.price === 24.4).every((s) => s.stale)).toBe(true);
    expect(res.stations.slice(0, 16).every((s) => !s.stale)).toBe(true);
  });
});
