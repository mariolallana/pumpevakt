// The single "Find" screen (docs/web-v1-contract.md scope 3).
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  fetchHealth,
  fetchMarket,
  fetchStations,
  FUEL_LABELS,
  sourceDown,
  type Fuel,
  type HealthResponse,
  type MarketResponse,
  type StationsResponse,
} from './api';
import { age, price2 } from './format';
import { MarketCard } from './MarketCard';
import { ListSkeleton, StationList } from './StationList';

const MapView = lazy(() => import('./MapView'));

const RADII = [5, 10, 20] as const;
type Origin = { lat: number; lon: number };

export default function App() {
  const [fuel, setFuel] = useState<Fuel>('diesel');
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [origin, setOrigin] = useState<Origin | null>(null); // null → Oslo S (the server default)
  const [locating, setLocating] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);

  const [data, setData] = useState<StationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchStations({ fuel, radiusKm, origin }, ac.signal)
      .then((r) => {
        setData(r);
        setSelectedId((id) => (id && r.stations.some((s) => s.id === id) ? id : null));
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [fuel, radiusKm, origin, reload]);

  useEffect(() => {
    const ac = new AbortController();
    fetchMarket(ac.signal)
      .then(setMarket)
      .catch(() => {})
      .finally(() => !ac.signal.aborted && setMarketLoading(false));
    fetchHealth(ac.signal)
      .then(setHealth)
      .catch(() => {});
    return () => ac.abort();
  }, [reload]);

  const nearMe = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGeoNote('Location isn’t available in this browser. Showing prices near Oslo S.');
      setOrigin(null);
      return;
    }
    setLocating(true);
    setGeoNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        setLocating(false);
        setOrigin(null);
        setGeoNote(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Showing prices near Oslo S.'
            : 'Couldn’t get your location. Showing prices near Oslo S.',
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  const down = health ? sourceDown(health) : false;
  const stations = data?.stations ?? [];
  const refPrice = data?.refPrice ?? null;
  const refIsLevel = fuel === 'diesel' && refPrice !== null && market?.latest.level === refPrice;
  const nextRadius = RADII.find((r) => r > radiusKm);
  const mapOrigin = data?.origin ?? origin;

  return (
    <div className="min-h-dvh lg:w-[400px] lg:border-r lg:border-line">
      <header className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pumpevakt</h1>
          <p className="text-xs text-muted">Oslo fuel prices, ranked by what you actually save</p>
        </div>
      </header>

      {down && health && (
        <div role="status" className="mx-4 mb-2 rounded-lg border border-alert px-3 py-2 text-sm text-alert">
          <strong className="font-semibold">⚠ Price source is having trouble.</strong>{' '}
          {health.jobs.prices.lastOk
            ? <>Last good update {age(Math.floor((Date.now() - Date.parse(health.jobs.prices.lastOk)) / 60_000))}. </>
            : <>No successful update yet. </>}
          Prices may be out of date.
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <label className="sr-only" htmlFor="fuel">
          Fuel
        </label>
        <select
          id="fuel"
          value={fuel}
          onChange={(e) => setFuel(e.target.value as Fuel)}
          className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm font-medium"
        >
          {(Object.keys(FUEL_LABELS) as Fuel[]).map((f) => (
            <option key={f} value={f}>
              {FUEL_LABELS[f]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={nearMe}
          disabled={locating}
          aria-pressed={origin !== null}
          className={`min-h-11 rounded-lg border px-3 text-sm font-medium disabled:opacity-60 ${origin ? 'border-ink bg-ink text-bg' : 'border-line bg-surface'}`}
        >
          <span aria-hidden="true">📍</span> {locating ? 'Locating…' : 'Near me'}
        </button>
      </div>
      <div className="flex items-center gap-2 px-4 pb-2">
        <span id="radius-l" className="text-xs text-muted">
          Radius
        </span>
        <div role="group" aria-labelledby="radius-l" className="flex gap-1">
          {RADII.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={radiusKm === r}
              onClick={() => setRadiusKm(r)}
              className={`num min-h-11 min-w-11 rounded-full border px-3 text-sm ${radiusKm === r ? 'border-ink bg-ink text-bg' : 'border-line bg-surface'}`}
            >
              {r} km
            </button>
          ))}
        </div>
      </div>
      <p className="px-4 pb-2 text-xs text-muted" aria-live="polite">
        {geoNote ?? (origin ? 'Near your location' : 'Near Oslo S · tap Near me for your location')}
      </p>

      <div className="px-4 pb-3">
        <MarketCard market={market} loading={marketLoading} />
      </div>

      {/* Map: inline on mobile, fixed to the right of the 400 px column on desktop. */}
      <div className="relative h-[30vh] min-h-[200px] border-y border-line lg:fixed lg:inset-y-0 lg:right-0 lg:left-[400px] lg:h-auto lg:border-0">
        <Suspense fallback={<div className="skeleton h-full w-full rounded-none" />}>
          <MapView
            origin={mapOrigin}
            radiusKm={radiusKm}
            stations={stations}
            refPrice={refPrice}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Suspense>
      </div>

      <section aria-labelledby="list-h" aria-busy={loading} className="pb-2">
        <div className="flex items-baseline justify-between gap-2 px-4 pt-4 pb-1">
          <h2 id="list-h" className="text-sm font-semibold">
            {loading && !data
              ? 'Loading stations…'
              : error
                ? `Stations within ${radiusKm} km`
                : `${stations.length} station${stations.length === 1 ? '' : 's'} within ${data?.radiusKm ?? radiusKm} km`}
          </h2>
          {refPrice !== null && !error && (
            <span className="text-xs text-muted">
              vs {refIsLevel ? 'Oslo average' : 'average nearby'} <span className="num text-ink">{price2(refPrice)}</span>
            </span>
          )}
        </div>
        {data && !error && data.coverage.jumpDetected && (
          <p className="px-4 pb-1 text-xs text-muted">
            Prices rose market-wide today. Showing <span className="num text-ink">{data.coverage.current}</span> of{' '}
            <span className="num text-ink">{data.coverage.current + data.coverage.hiddenOutdated}</span> stations with a price
            from after the rise; the rest are hidden until someone reports a new price.
          </p>
        )}
        {stations.length > 0 && !error && (
          <p className="px-4 pb-2 text-xs text-muted">Savings are for a full tank, if you go there just to fill up.</p>
        )}

        {error && (
          <div role="alert" className="mx-4 my-2 flex items-center justify-between gap-3 rounded-lg border border-alert px-3 py-2 text-sm text-alert">
            <span>Couldn’t load prices ({error}).</span>
            <button type="button" onClick={() => setReload((n) => n + 1)} className="min-h-11 rounded-lg border border-alert px-3 font-medium">
              Retry
            </button>
          </div>
        )}

        {loading && !data ? (
          <ListSkeleton />
        ) : !error && stations.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm">
              No fresh prices within {radiusKm} km.{nextRadius ? ` Widen to ${nextRadius} km?` : ''}
            </p>
            {nextRadius && (
              <button
                type="button"
                onClick={() => setRadiusKm(nextRadius)}
                className="num mt-3 min-h-11 rounded-full border border-ink px-4 text-sm font-medium"
              >
                Widen to {nextRadius} km
              </button>
            )}
          </div>
        ) : (
          <div className={loading ? 'opacity-60 transition-opacity' : ''}>
            <StationList stations={stations} refPrice={refPrice} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        )}
      </section>

      <footer className="border-t border-line px-4 py-4 text-xs text-muted">
        Prices: <a className="underline" href="https://drivstoffapp.no" target="_blank" rel="noopener noreferrer">drivstoffapp.no</a> ·
        Map © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>,{' '}
        <a className="underline" href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>
        <span className="block pt-1">Wholesale index: FRED · Norges Bank.</span>
        <span className="block pt-1">Stale (&gt; 6 h) prices are greyed; prices older than 24 h are hidden.</span>
      </footer>
    </div>
  );
}
