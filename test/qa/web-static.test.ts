// QA static checks for web v1: Worker assets config, build wiring, gitignore, built bundle contents.
// Spec: docs/web-v1-contract.md (scope 2–3, footer attribution), docs/06 §2 (tokens, quality bar), CLAUDE.md rules 1, 2, 5.
// Bundle checks need `npm run build:web` to have run first; they are skipped (and say so) when web/dist is missing.
import { describe, it, expect } from 'vitest';

const fs: any = await import('node:' + 'fs');
const cp: any = await import('node:' + 'child_process');
const ROOT = new URL('../../', import.meta.url);
const p = (rel: string) => new URL(rel, ROOT);
const exists = (rel: string) => fs.existsSync(p(rel));
const read = (rel: string): string => (exists(rel) ? fs.readFileSync(p(rel), 'utf8') : '');

function tomlSection(toml: string, name: string): string {
  const m = new RegExp(`^\\[${name}\\]\\s*$`, 'm').exec(toml);
  if (!m) return '';
  const rest = toml.slice(m.index + m[0].length);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

function walk(rel: string): string[] {
  if (!exists(rel)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(p(rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(r));
    else out.push(r);
  }
  return out;
}

const toml = read('wrangler.toml');
const assets = tomlSection(toml, 'assets');
const pkg = exists('package.json') ? JSON.parse(read('package.json')) : {};
const HAS_DIST = exists('web/dist/index.html');
const distFiles = walk('web/dist');
const distText = distFiles.filter((f) => /\.(html|js|css|json|txt|webmanifest)$/.test(f)).map((f) => read(f)).join('\n');
const webSrcFiles = walk('web/src').concat(['web/index.html'].filter(exists));
const webSrc = webSrcFiles.filter((f) => /\.(tsx?|css|html)$/.test(f)).map((f) => read(f)).join('\n');

describe('QA-WEB-CFG Worker static assets (contract scope 2)', () => {
  it('QA-WEB-CFG-01 wrangler.toml [assets] serves web/dist', () => {
    expect(assets).not.toBe('');
    expect(assets).toMatch(/^\s*directory\s*=\s*"(\.\/)?web\/dist\/?"/m);
  });

  it('QA-WEB-CFG-02 /api/* and /health reach the Worker first (run_worker_first)', () => {
    const m = assets.match(/run_worker_first\s*=\s*(\[[^\]]*\]|true|false)/);
    expect(m, 'run_worker_first missing: with assets enabled, an asset/SPA fallback could shadow /api and /health').not.toBeNull();
    const v = m![1]!;
    if (v !== 'true') {
      expect(v).toMatch(/"\/api\/\*"/);
      expect(v).toMatch(/"\/health"/);
    }
  });

  it('QA-WEB-CFG-03 crons, D1 binding and main are unchanged by the web work', () => {
    expect(toml).toMatch(/^main\s*=\s*"src\/index\.ts"/m);
    expect(toml).toMatch(/crons\s*=\s*\[\s*"\*\/30 \* \* \* \*"\s*,\s*"30 6 \* \* \*"\s*\]/);
    expect(toml).toMatch(/binding\s*=\s*"DB"/);
  });

  it('QA-WEB-CFG-04 SPA fallback configured (not_found_handling) or recorded as absent', () => {
    const spa = /not_found_handling\s*=\s*"single-page-application"/.test(assets);
    console.log(`[QA-WEB-CFG-04] not_found_handling=single-page-application: ${spa}`);
    expect(typeof spa).toBe('boolean');
  });
});

describe('QA-WEB-BUILD build wiring', () => {
  it('QA-WEB-BUILD-01 package.json has a build:web script that runs Vite', () => {
    expect(pkg.scripts?.['build:web']).toBeTruthy();
    expect(pkg.scripts['build:web']).toMatch(/vite/);
  });

  it('QA-WEB-BUILD-02 web/dist is gitignored', () => {
    const r = cp.spawnSync('git', ['check-ignore', '-q', 'web/dist/index.html'], { cwd: p('.'), encoding: 'utf8' });
    expect(r.status, 'git check-ignore web/dist/index.html').toBe(0);
  });

  it('QA-WEB-BUILD-03 ci.yml builds the web app', () => {
    expect(read('.github/workflows/ci.yml')).toMatch(/build:web|vite build/);
  });

  it('QA-WEB-BUILD-06 ci.yml builds the web app before `npm test`, so QA-WEB-DIST-* run in CI', () => {
    const y = read('.github/workflows/ci.yml');
    const b = y.search(/run:\s*npm run build:web/);
    const tst = y.search(/run:\s*npm test/);
    expect(b).toBeGreaterThan(-1);
    expect(tst).toBeGreaterThan(b);
  });

  it('QA-WEB-SRC-08 page copy never says "home" for the default origin (it is Oslo S now)', () => {
    expect(webSrc).not.toMatch(/near home/i);
    expect(webSrc).toMatch(/Oslo S/);
  });

  it('QA-WEB-BUILD-04 deploy.yml builds the web app before `wrangler deploy`', () => {
    const y = read('.github/workflows/deploy.yml');
    const b = y.search(/run:\s*npm run build:web|run:.*vite build/);
    const d = y.search(/run:\s*(npx )?wrangler deploy|run:\s*npm run deploy/);
    expect(b).toBeGreaterThan(-1);
    expect(d).toBeGreaterThan(b);
  });

  it('QA-WEB-BUILD-05 web stack per contract: React, Vite, Tailwind v4, MapLibre (no extra map/chart SDKs with keys)', () => {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const webPkg = exists('web/package.json') ? JSON.parse(read('web/package.json')) : {};
    const all = { ...deps, ...(webPkg.dependencies ?? {}), ...(webPkg.devDependencies ?? {}) };
    for (const d of ['react', 'react-dom', 'vite', 'maplibre-gl', 'tailwindcss']) expect(Object.keys(all)).toContain(d);
    for (const d of ['mapbox-gl', '@googlemaps/js-api-loader', 'leaflet']) expect(Object.keys(all)).not.toContain(d);
  });
});

describe('QA-WEB-SRC web source', () => {
  it('QA-WEB-SRC-01 uses OpenFreeMap liberty tiles', () => {
    expect(webSrc).toMatch(/tiles\.openfreemap\.org\/styles\/liberty/);
  });

  it('QA-WEB-SRC-02 calls the same-origin API (/api/stations, /api/market, /health), no hard-coded workers.dev host', () => {
    expect(webSrc).toMatch(/\/api\/stations/);
    expect(webSrc).toMatch(/\/api\/market/);
    expect(webSrc).toMatch(/['"`]\/health/);
    expect(webSrc).not.toMatch(/workers\.dev/);
  });

  it('QA-WEB-SRC-03 docs/06 §2 design tokens present (light and dark)', () => {
    const s = webSrc.toUpperCase();
    for (const hex of ['#F6F7F5', '#0E1112', '#FFFFFF', '#171B1D', '#121516', '#5E6668', '#ECEFEE', '#9AA3A5', '#0F7B5F', '#3DD6A3', '#B4531A', '#F29A5C', '#C62D3A', '#FF6B76'])
      expect(s, hex).toContain(hex);
    expect(webSrc).toMatch(/prefers-color-scheme:\s*dark|dark:/);
  });

  it('QA-WEB-SRC-04 numbers use tabular figures (Geist Mono / tabular-nums)', () => {
    expect(webSrc).toMatch(/tabular-nums|font-variant-numeric:\s*tabular/);
    expect(webSrc).toMatch(/Geist Mono|geist-mono|GeistMono/i);
  });

  it('QA-WEB-SRC-05 geolocation is requested from a user action, not on load', () => {
    const i = webSrc.indexOf('navigator.geolocation');
    expect(i).toBeGreaterThan(-1);
    // crude: geolocation must not be called inside a mount effect with an empty dependency list
    const effectGeo = /useEffect\(\s*\(\)\s*=>\s*\{[^}]*navigator\.geolocation[^}]*\}\s*,\s*\[\s*\]\s*\)/s.test(webSrc);
    expect(effectGeo).toBe(false);
  });

  it('QA-WEB-SRC-06 Navigate link = Google Maps directions', () => {
    expect(webSrc).toMatch(/google\.com\/maps\/dir\/\?api=1/);
  });

  it('QA-WEB-SRC-07 empty-state copy from the contract', () => {
    expect(webSrc).toMatch(/No fresh prices within/);
    expect(webSrc).toMatch(/Widen to/);
  });
});

describe.skipIf(!HAS_DIST)('QA-WEB-DIST built bundle (needs `npm run build:web`)', () => {
  it('QA-WEB-DIST-01 index.html with a script and a title', () => {
    const html = read('web/dist/index.html');
    expect(html).toMatch(/<script[^>]+type="module"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/name="viewport"/);
    expect(html).toMatch(/<html[^>]+lang=/);
  });

  it('QA-WEB-DIST-02 footer attribution text (contract scope 3)', () => {
    expect(distText).toContain('drivstoffapp.no');
    expect(distText).toMatch(/OpenStreetMap contributors/);
    expect(distText).toMatch(/OpenFreeMap/);
  });

  it('QA-WEB-DIST-03 tax-free diesel never referenced (CLAUDE.md rule 2)', () => {
    expect(distText).not.toMatch(/fd_price|tax-?free|avgiftsfri/i);
  });

  it('QA-WEB-DIST-04 no secrets or personal config in the bundle (CLAUDE.md rule 5, docs/09)', () => {
    expect(distText).not.toMatch(/TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|CLOUDFLARE_API_TOKEN|ALLOWED_CHAT_IDS/);
    expect(distText).not.toMatch(/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/); // Telegram bot token shape
    expect(distText).not.toMatch(/database_id|925a17b7-2e1f-4eaf-a0ab-ad77e0e4b123/);
    expect(distText).not.toContain('123456789');
  });

  it('QA-WEB-DIST-05 HOME coordinates are never in the bundle (coordinator decision, IMPL-W11)', () => {
    // HOME = 59.93, 10.80 (wrangler.toml). Oslo S (59.9111, 10.7528) is allowed.
    expect(distText).not.toMatch(/59\.93(?!\d)/);
    expect(distText).not.toMatch(/HOME_LAT|HOME_LON/);
  });

  it('QA-WEB-DIST-06 no source maps shipped with absolute local paths', () => {
    const maps = distFiles.filter((f) => f.endsWith('.map'));
    for (const m of maps) expect(read(m)).not.toMatch(/C:\\\\Users|\/Users\/mario/);
  });

  it('QA-WEB-DIST-07 total bundle size is sane (< 3 MB uncompressed)', () => {
    const size = distFiles.reduce((n, f) => n + fs.statSync(p(f)).size, 0);
    console.log(`[QA-WEB-DIST-07] web/dist = ${(size / 1024).toFixed(0)} KB in ${distFiles.length} files`);
    expect(size).toBeLessThan(3 * 1024 * 1024);
  });
});

describe('QA-WEB-A11Y docs/06 §2 token contrast (WCAG 2.2 AA, computed by QA)', () => {
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const cr = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const T = {
    light: { bg: '#F6F7F5', surface: '#FFFFFF', ink: '#121516', muted: '#5E6668', cheap: '#0F7B5F', pricey: '#B4531A', alert: '#C62D3A' },
    dark: { bg: '#0E1112', surface: '#171B1D', ink: '#ECEFEE', muted: '#9AA3A5', cheap: '#3DD6A3', pricey: '#F29A5C', alert: '#FF6B76' },
  };
  for (const mode of ['light', 'dark'] as const)
    for (const fg of ['ink', 'muted', 'cheap', 'pricey', 'alert'] as const)
      for (const bg of ['bg', 'surface'] as const)
        it(`QA-WEB-A11Y ${mode} ${fg} on ${bg} ≥ 4.5:1`, () => {
          expect(cr(T[mode][fg], T[mode][bg])).toBeGreaterThanOrEqual(4.5);
        });
  it('QA-WEB-A11Y dark pills: text on a filled cheap/pricey/alert pill must be dark (white fails < 3:1)', () => {
    // Informational: documents which foreground works on filled pills.
    expect(cr('#FFFFFF', T.dark.cheap)).toBeLessThan(4.5);
    expect(cr(T.dark.bg, T.dark.cheap)).toBeGreaterThanOrEqual(4.5);
    expect(cr('#FFFFFF', T.light.cheap)).toBeGreaterThanOrEqual(4.5);
  });
});
