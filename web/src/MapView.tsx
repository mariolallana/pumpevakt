// MapLibre + OpenFreeMap map with HTML price-pill markers. Lazy-loaded so the list renders first.
// The list is the accessible mirror of the map; pills are still real, labelled buttons.
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { StationItem } from './api';
import { delta, price2 } from './format';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
/** Full price pills only for the best N rows (plus the selected one); the rest are compact ▼/▲ dots, so a dense
 *  10 km view stays readable on a 375 px screen. */
const TOP_PILLS = 10;
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

interface Props {
  origin: { lat: number; lon: number } | null;
  radiusKm: number;
  stations: StationItem[];
  refPrice: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function MapView({ origin, radiusKm, stations, refPrice, selectedId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; btn: HTMLButtonElement }>());
  const originMarker = useRef<maplibregl.Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Create the map once; follow the colour scheme.
  useEffect(() => {
    if (!el.current) return;
    const mq = darkQuery();
    const m = new maplibregl.Map({
      container: el.current,
      style: mq.matches ? STYLE_DARK : STYLE_LIGHT,
      center: [10.75, 59.91],
      zoom: 11,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    // Start with the compact attribution collapsed (the ⓘ button expands it; the page footer repeats it).
    m.once('load', () => el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
    map.current = m;
    const onScheme = () => m.setStyle(mq.matches ? STYLE_DARK : STYLE_LIGHT);
    mq.addEventListener('change', onScheme);
    return () => {
      mq.removeEventListener('change', onScheme);
      markers.current.clear();
      originMarker.current = null;
      m.remove();
      map.current = null;
    };
  }, []);

  // Sync markers with the station list (and the selection: it decides pill vs dot and stacking).
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    stations.forEach((s, rank) => {
      seen.add(s.id);
      const d = delta(s.price, refPrice);
      let entry = markers.current.get(s.id);
      if (!entry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pill';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectRef.current(s.id);
        });
        const mk = new maplibregl.Marker({ element: btn }).setLngLat([s.lon, s.lat]).addTo(m);
        entry = { m: mk, btn };
        markers.current.set(s.id, entry);
      }
      const selected = s.id === selectedId;
      const full = rank < TOP_PILLS || selected;
      const arrow = d && d.tone !== 'neutral' ? d.arrow : '';
      entry.m.setLngLat([s.lon, s.lat]);
      entry.btn.textContent = full ? `${arrow}${price2(s.price)}` : arrow || '•';
      entry.btn.dataset.compact = String(!full);
      entry.btn.dataset.tone = d?.tone ?? 'neutral';
      entry.btn.dataset.stale = String(s.stale || s.unconfirmed);
      entry.btn.setAttribute('aria-pressed', String(selected));
      entry.btn.style.zIndex = selected ? '3' : full ? String(2 + (TOP_PILLS - rank) / 100) : '1';
      entry.btn.setAttribute(
        'aria-label',
        `${s.name}, ${price2(s.price)} kroner per litre${d ? `, ${d.text}` : ''}${s.stale ? ', stale price' : s.unconfirmed ? ', unconfirmed price' : ''}`,
      );
    });
    for (const [id, e] of markers.current) {
      if (!seen.has(id)) {
        e.m.remove();
        markers.current.delete(id);
      }
    }
  }, [stations, refPrice, selectedId]);

  // Origin dot + fit the view to the search circle.
  useEffect(() => {
    const m = map.current;
    if (!m || !origin) return;
    if (!originMarker.current) {
      const dot = document.createElement('div');
      dot.className = 'origin-dot';
      dot.setAttribute('aria-hidden', 'true');
      originMarker.current = new maplibregl.Marker({ element: dot }).setLngLat([origin.lon, origin.lat]).addTo(m);
    } else originMarker.current.setLngLat([origin.lon, origin.lat]);
    const dLat = radiusKm / 111.2;
    const dLon = dLat / Math.cos((origin.lat * Math.PI) / 180);
    m.fitBounds(
      [
        [origin.lon - dLon, origin.lat - dLat],
        [origin.lon + dLon, origin.lat + dLat],
      ],
      { padding: 24, duration: 0 },
    );
  }, [origin?.lat, origin?.lon, radiusKm]);

  // Bring the selected pill into view.
  useEffect(() => {
    const m = map.current;
    const s = selectedId ? stations.find((x) => x.id === selectedId) : undefined;
    if (m && s && !m.getBounds().contains([s.lon, s.lat])) m.easeTo({ center: [s.lon, s.lat], duration: 400 });
  }, [selectedId, stations]);

  return <div ref={el} className="h-full w-full" role="region" aria-label="Map of stations with price pills. The list mirrors the map." />;
}
