// Feasibility probe for every open data source in docs/01-data-sources.md.
// Run: node scripts/probe-sources.mjs   (Node 20+, no dependencies)
// Prints one line per source: OK / STALE / FAIL plus the key facts.

const OSLO = { lat: 59.9111, lon: 10.7528 };
const UA = { 'User-Agent': 'pumpevakt-probe/0.2 (github.com/mariolallana/pumpevakt)' };
const DPS = 'https://drivstoffpriser.github.io/Drivstoffpriser-App/data';

const km = (a, b, c, d) => {
  const p = Math.PI / 180;
  const h = Math.sin(((c - a) * p) / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(((d - b) * p) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const daysAgo = (iso) => (Date.now() - new Date(iso).getTime()) / 864e5;
const get = async (url, init) => {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};
const csvRows = (text, sep = ',') => text.trim().split('\n').slice(1).map((l) => l.split(sep));

const probes = {
  // Station master data: ODbL community list
  async drivstoffpriser_stations() {
    const { stations } = await (await get(`${DPS}/stations.json`)).json();
    const oslo = stations.filter((s) => km(OSLO.lat, OSLO.lon, s.latitude, s.longitude) <= 25);
    return { status: 'OK', detail: `${stations.length} stations in Norway, ${oslo.length} within 25 km of Oslo` };
  },
  // Station prices: ODbL community crowd data (12-hourly export)
  async drivstoffpriser_prices() {
    const { prices, exportedAt } = await (await get(`${DPS}/prices.json`)).json();
    const newest = Math.min(...prices.map((p) => daysAgo(p.updatedAt)));
    return {
      status: newest < 2 ? 'OK' : 'STALE',
      detail: `${prices.length} prices, newest is ${newest.toFixed(0)} days old (export ${exportedAt.slice(0, 10)})`,
    };
  },
  // Station master data: OpenStreetMap
  async osm_overpass() {
    const q = `[out:json][timeout:60];nwr["amenity"="fuel"](around:25000,${OSLO.lat},${OSLO.lon});out center tags;`;
    const d = await (await get('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }) })).json();
    const priced = d.elements.filter((e) => Object.keys(e.tags).some((k) => k.startsWith('fuel:price'))).length;
    return { status: 'OK', detail: `${d.elements.length} fuel stations within 25 km, ${priced} with price tags` };
  },
  // Wholesale diesel: NY Harbor ULSD (USD/gal), daily, FRED keyless CSV
  async fred_ulsd() {
    const rows = csvRows(await (await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DDFUELNYH&cosd=2026-01-01')).text()).filter((r) => r[1] !== '.');
    const [d, v] = rows.at(-1);
    return { status: daysAgo(d) < 7 ? 'OK' : 'STALE', detail: `ULSD ${v} USD/gal on ${d}` };
  },
  // Crude: Brent (USD/bbl), daily, FRED keyless CSV
  async fred_brent() {
    const rows = csvRows(await (await get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DCOILBRENTEU&cosd=2026-01-01')).text()).filter((r) => r[1] !== '.');
    const [d, v] = rows.at(-1);
    return { status: daysAgo(d) < 7 ? 'OK' : 'STALE', detail: `Brent ${v} USD/bbl on ${d}` };
  },
  // FX: USD/NOK, daily, Norges Bank open SDMX
  async norges_bank_usdnok() {
    const rows = csvRows(await (await get('https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=csv&lastNObservations=1&locale=en')).text(), ';');
    const r = rows.at(-1);
    return { status: 'OK', detail: `USD/NOK ${r.at(-1)} on ${r.at(-2)}` };
  },
  // Official pump average: SSB table 09654, monthly, national
  async ssb_09654() {
    const body = { query: [{ code: 'Tid', selection: { filter: 'top', values: ['1'] } }], response: { format: 'json-stat2' } };
    const d = await (await get('https://data.ssb.no/api/v0/no/table/09654', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })).json();
    const month = Object.keys(d.dimension.Tid.category.index)[0];
    return { status: 'OK', detail: `${month}: petrol95 ${d.value[0]}, diesel ${d.value[1]} NOK/L` };
  },
  // National pump average, roughly weekly, keyless
  async openvan_national() {
    const d = (await (await get('https://openvan.camp/api/fuel/prices?country=NO')).json()).data.NO;
    return { status: daysAgo(d.fetched_at) < 10 ? 'OK' : 'STALE', detail: `diesel ${d.prices.diesel?.toFixed(2)}, petrol95 ${d.prices.gasoline?.toFixed(2)} NOK/L (fetched ${d.fetched_at.slice(0, 10)})` };
  },
};

for (const [name, fn] of Object.entries(probes)) {
  try {
    const { status, detail } = await fn();
    console.log(`${status.padEnd(5)} ${name.padEnd(24)} ${detail}`);
  } catch (e) {
    console.log(`FAIL  ${name.padEnd(24)} ${e.message}`);
  }
}
