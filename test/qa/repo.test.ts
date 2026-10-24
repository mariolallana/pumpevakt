// QA non-code checks: wrangler.toml, migration, workflows, package scripts, secrets hygiene.
// Spec: docs/05 §3, docs/03, docs/02 §2/§6, docs/08 Phase 1, docs/09 Security, CLAUDE.md.
import { describe, it, expect } from 'vitest';

// node built-ins via non-literal specifiers so the suite typechecks without @types/node
const fs: any = await import('node:' + 'fs');
const cp: any = await import('node:' + 'child_process');
const ROOT = new URL('../../', import.meta.url);
const p = (rel: string) => new URL(rel, ROOT);
const exists = (rel: string) => fs.existsSync(p(rel));
const read = (rel: string): string => fs.readFileSync(p(rel), 'utf8');

/** Strip SQL comments and normalise whitespace/case for comparison. */
function normSql(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1').trim().toLowerCase())
    .filter(Boolean);
}

function tomlArray(toml: string, key: string): string[] | null {
  const m = toml.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm'));
  if (!m) return null;
  return [...m[1]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!);
}
function tomlSection(toml: string, name: string): string {
  const re = new RegExp(`^\\[${name.replace(/[[\]]/g, '\\$&')}\\]\\s*$`, 'm');
  const m = re.exec(toml);
  if (!m) return '';
  const rest = toml.slice(m.index + m[0].length);
  const next = rest.search(/^\[/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('QA-CFG wrangler.toml', () => {
  const toml = exists('wrangler.toml') ? read('wrangler.toml') : '';
  it('QA-CFG-01 exists, main = src/index.ts', () => {
    expect(toml).not.toBe('');
    expect(toml).toMatch(/^main\s*=\s*"src\/index\.ts"/m);
  });
  it('QA-CFG-02 cron triggers exactly match docs/05 §3', () => {
    expect(tomlArray(tomlSection(toml, 'triggers'), 'crons')).toEqual(['*/30 * * * *', '30 6 * * *']);
  });
  it('QA-CFG-03 D1 binding "DB", database pumpevakt, migrations in db/migrations', () => {
    const d1 = tomlSection(toml, '[d1_databases]');
    expect(d1).toMatch(/binding\s*=\s*"DB"/);
    expect(d1).toMatch(/database_name\s*=\s*"pumpevakt"/);
    expect(d1).toMatch(/migrations_dir\s*=\s*"db\/migrations"/);
  });
  it('QA-CFG-04 [vars] has every config key from docs/03', () => {
    const vars = tomlSection(toml, 'vars');
    for (const k of ['HOME_LAT', 'HOME_LON', 'FUEL', 'TANK_L', 'CONSUMPTION_L100', 'SENSITIVITY', 'QUIET_HOURS', 'ALLOWED_CHAT_IDS']) {
      expect(vars, k).toMatch(new RegExp(`^${k}\\s*=`, 'm'));
    }
    expect(vars).toMatch(/^FUEL\s*=\s*"diesel"/m);
    expect(vars).toMatch(/^SENSITIVITY\s*=\s*"(relaxed|normal|eager)"/m);
    expect(vars).toMatch(/^QUIET_HOURS\s*=\s*"22-07"/m);
  });
  it('QA-CFG-05 secrets are not in [vars]', () => {
    expect(toml).not.toMatch(/^\s*TELEGRAM_BOT_TOKEN\s*=/m);
    expect(toml).not.toMatch(/^\s*TELEGRAM_WEBHOOK_SECRET\s*=/m);
    expect(toml).not.toMatch(/\d{8,10}:[A-Za-z0-9_-]{35}/);
  });
});

describe('QA-MIG migration', () => {
  it('QA-MIG-01 db/migrations/0001_*.sql exists and is the only Phase 1 migration', () => {
    const files: string[] = exists('db/migrations') ? fs.readdirSync(p('db/migrations/')) : [];
    const sql = files.filter((f) => f.endsWith('.sql'));
    expect(sql.filter((f) => f.startsWith('0001'))).toHaveLength(1);
  });
  it('QA-MIG-02 migration 0001 equals db/schema.sql (ignoring comments/whitespace)', () => {
    const files: string[] = fs.readdirSync(p('db/migrations/'));
    const f = files.find((x) => x.startsWith('0001') && x.endsWith('.sql'))!;
    expect(normSql(read(`db/migrations/${f}`))).toEqual(normSql(read('db/schema.sql')));
  });
});

describe('QA-CI GitHub workflows (docs/02 §2, docs/08 Phase 1)', () => {
  const wf = (n: string) => (exists(`.github/workflows/${n}`) ? read(`.github/workflows/${n}`) : '');
  it('QA-CI-01 ci.yml exists and runs typecheck and tests', () => {
    const ci = wf('ci.yml');
    expect(ci).not.toBe('');
    expect(ci).toMatch(/npm (run )?typecheck|tsc --noEmit/);
    expect(ci).toMatch(/npm (run )?test|npx vitest/);
    expect(ci).toMatch(/npm ci|npm install/);
    expect(ci).toMatch(/pull_request|push/);
  });
  it('QA-CI-02 deploy.yml exists, applies D1 migrations remotely and deploys with wrangler', () => {
    const d = wf('deploy.yml');
    expect(d).not.toBe('');
    expect(d).toMatch(/d1 migrations apply/);
    expect(d).toMatch(/--remote/);
    expect(d).toMatch(/wrangler deploy|wrangler-action|command:\s*deploy/);
  });
  it('QA-CI-03 deploy.yml gates on typecheck + tests (or on CI) before deploying', () => {
    const d = wf('deploy.yml');
    expect(/npm (run )?test|vitest/.test(d) || /workflow_run|needs:/.test(d)).toBe(true);
  });
  it('QA-CI-04 deploy credentials come from GitHub secrets', () => {
    const d = wf('deploy.yml');
    expect(d).toMatch(/\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
    expect(d).not.toMatch(/apiToken:\s*['"]?[A-Za-z0-9_-]{30,}/);
  });
});

describe('QA-PKG package + tooling (contract)', () => {
  const pkg = JSON.parse(read('package.json'));
  it('QA-PKG-01 ESM, scripts test + typecheck', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.test).toMatch(/vitest/);
    expect(pkg.scripts.typecheck).toMatch(/tsc --noEmit/);
  });
  it('QA-PKG-02 TypeScript strict', () => {
    const ts = read('tsconfig.json');
    expect(ts).toMatch(/"strict"\s*:\s*true/);
  });
  it('QA-PKG-03 vitest picks up test/qa', () => {
    const v = read('vitest.config.ts');
    expect(v).toMatch(/test\/\*\*\/\*\.test\.ts/);
  });
  it('QA-PKG-04 no runtime dependencies beyond the stack (Phase 1 needs none)', () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    const allowed = ['grammy'];
    expect(deps.filter((d) => !allowed.includes(d))).toEqual([]);
  });
});

describe('QA-SEC secrets hygiene (docs/09, CLAUDE.md rule 5)', () => {
  it('QA-SEC-01 .gitignore ignores .dev.vars', () => {
    expect(read('.gitignore')).toMatch(/^\.dev\.vars\s*$/m);
  });
  it('QA-SEC-04 .gitignore also ignores .env files (wrangler 4 reads local secrets from .env too)', () => {
    expect(read('.gitignore')).toMatch(/^\.env(\*|\b)/m);
  });
  it('QA-SEC-02 no .dev.vars / .env tracked or staged in git', () => {
    let out = '';
    try {
      out = cp.execSync('git ls-files --cached', { cwd: p('./'), encoding: 'utf8' });
    } catch {
      return; // not a git checkout (e.g. CI artefact) — nothing tracked
    }
    expect(out.split('\n').filter((f: string) => /(^|\/)\.dev\.vars$|(^|\/)\.env$/.test(f))).toEqual([]);
  });
  it('QA-SEC-03 no Telegram bot token or Cloudflare token literal in src/, config or workflows', () => {
    const files: string[] = [];
    const walk = (rel: string) => {
      if (!exists(rel)) return;
      for (const e of fs.readdirSync(p(rel), { withFileTypes: true })) {
        const r = `${rel}${e.name}`;
        if (e.isDirectory()) walk(`${r}/`);
        else files.push(r);
      }
    };
    walk('src/');
    walk('.github/');
    files.push('wrangler.toml', 'package.json');
    for (const f of files) {
      const t = read(f);
      expect(t, f).not.toMatch(/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/);
      expect(t, f).not.toMatch(/(api[_-]?token|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_-]{30,}/i);
    }
  });
});

describe('QA-SRC source hygiene', () => {
  it('QA-SRC-01 src/index.ts, src/types.ts and contract modules exist', () => {
    for (const f of ['src/index.ts', 'src/types.ts', 'src/core/geo.ts', 'src/core/stats.ts', 'src/core/osloLevel.ts', 'src/core/wdi.ts',
      'src/sources/drivstoffapp.ts', 'src/sources/fred.ts', 'src/sources/norgesBank.ts', 'src/jobs/prices.ts', 'src/jobs/market.ts']) {
      expect(exists(f), f).toBe(true);
    }
  });
  it('QA-SRC-02 only open, keyless hosts are contacted from src/', () => {
    const allowed = ['backend.drivstoffapp.no', 'fred.stlouisfed.org', 'data.norges-bank.no', 'api.telegram.org', 'github.com'];
    const walk = (rel: string): string[] =>
      fs.readdirSync(p(rel), { withFileTypes: true }).flatMap((e: any) => (e.isDirectory() ? walk(`${rel}${e.name}/`) : [`${rel}${e.name}`]));
    for (const f of walk('src/')) {
      for (const m of read(f).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) expect(allowed, `${f}: ${m[0]}`).toContain(m[1]!.toLowerCase());
    }
  });
});
