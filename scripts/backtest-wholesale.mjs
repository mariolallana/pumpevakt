// Backtest: does the open-data Wholesale Diesel Index (WDI) track Norwegian pump prices?
// WDI (NOK/L) = NY Harbor ULSD (USD/gal, FRED) / 3.78541 × USD/NOK (Norges Bank)
// Compared against SSB table 09654 monthly national diesel pump price.
// Run: node scripts/backtest-wholesale.mjs

const UA = { 'User-Agent': 'pumpevakt-backtest/0.1' };
const text = async (url, init) => (await fetch(url, { ...init, headers: { ...UA, ...(init?.headers ?? {}) } })).text();

const monthlyMean = (rows) => {
  const m = {};
  for (const [d, v] of rows) {
    const x = Number(v);
    if (!Number.isFinite(x)) continue;
    (m[d.slice(0, 7)] ??= []).push(x);
  }
  return Object.fromEntries(Object.entries(m).map(([k, xs]) => [k, xs.reduce((a, b) => a + b) / xs.length]));
};

const ulsd = monthlyMean(
  (await text('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DDFUELNYH&cosd=2015-01-01')).trim().split('\n').slice(1).map((l) => l.split(',')),
);
const fx = monthlyMean(
  (await text('https://data.norges-bank.no/api/data/EXR/B.USD.NOK.SP?format=csv&startPeriod=2015-01-01&locale=en'))
    .trim().split('\n').slice(1).map((l) => l.split(';').slice(-2)),
);
const ssb = JSON.parse(
  await text('https://data.ssb.no/api/v0/no/table/09654', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: [
        { code: 'PetroleumProd', selection: { filter: 'item', values: ['035'] } },
        { code: 'Tid', selection: { filter: 'top', values: ['130'] } },
      ],
      response: { format: 'json-stat2' },
    }),
  }),
);
const pump = Object.fromEntries(Object.keys(ssb.dimension.Tid.category.index).map((m, i) => [m.replace('M', '-'), ssb.value[i]]));

const months = Object.keys(pump).filter((m) => ulsd[m] && fx[m] && pump[m]).sort();
const wdi = Object.fromEntries(months.map((m) => [m, (ulsd[m] / 3.78541) * fx[m]]));
const diff = (o) => months.slice(1).map((m, i) => o[m] - o[months[i]]);
const corr = (a, b) => {
  const ma = a.reduce((x, y) => x + y) / a.length, mb = b.reduce((x, y) => x + y) / b.length;
  let n = 0, da = 0, db = 0;
  a.forEach((x, i) => { n += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; });
  return n / Math.sqrt(da * db);
};

const dW = diff(wdi), dP = diff(pump);
const big = dW.map((w, i) => [w, dP[i]]).filter(([w]) => Math.abs(w) > 0.5);
const hits = big.filter(([w, p]) => Math.sign(w) === Math.sign(p)).length;

console.log(`Months compared: ${months[0]} .. ${months.at(-1)} (${months.length})`);
console.log(`Correlation, level:                         ${corr(months.map((m) => wdi[m]), months.map((m) => pump[m])).toFixed(2)}`);
console.log(`Correlation, monthly change (same month):   ${corr(dW, dP).toFixed(2)}`);
console.log(`Correlation, monthly change (pump +1 month): ${corr(dW.slice(0, -1), dP.slice(1)).toFixed(2)}`);
console.log(`Big WDI moves (>0.5 NOK/L): ${big.length}, pump moved the same way that month: ${hits} (${Math.round((100 * hits) / big.length)} %)`);
console.log('Last 6 months (NOK/L):');
for (const m of months.slice(-6)) console.log(`  ${m}  WDI ${wdi[m].toFixed(2)}  pump ${pump[m].toFixed(2)}`);
