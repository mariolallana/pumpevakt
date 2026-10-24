// Does Google Places API (New) return fuel prices for Oslo stations?
// Needs a key with "Places API (New)" enabled:
//   GOOGLE_MAPS_API_KEY=... node scripts/probe-google-places.mjs
// One call = one "Nearby Search Enterprise + Atmosphere" request (billed SKU;
// check your monthly free cap in the Google Cloud console before automating).

const key = process.env.GOOGLE_MAPS_API_KEY;
if (!key) {
  console.error('Set GOOGLE_MAPS_API_KEY first.');
  process.exit(1);
}

const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': key,
    'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.fuelOptions',
  },
  body: JSON.stringify({
    includedTypes: ['gas_station'],
    maxResultCount: 20,
    locationRestriction: { circle: { center: { latitude: 59.9111, longitude: 10.7528 }, radius: 10000 } },
  }),
});
const data = await res.json();
if (!res.ok) {
  console.error(res.status, JSON.stringify(data, null, 2));
  process.exit(1);
}

const places = data.places ?? [];
const priced = places.filter((p) => p.fuelOptions?.fuelPrices?.length);
console.log(`${places.length} stations returned, ${priced.length} with fuel prices`);
for (const p of priced) {
  const prices = p.fuelOptions.fuelPrices.map((f) => `${f.type} ${f.price.units}.${String(f.price.nanos ?? 0).padStart(9, '0').slice(0, 2)} (${f.updateTime})`);
  console.log(`- ${p.displayName.text}: ${prices.join(', ')}`);
}
console.log(priced.length ? 'VERDICT: usable, so add a google_places adapter (docs/01).' : 'VERDICT: no Norwegian fuel prices in Google Places.');
