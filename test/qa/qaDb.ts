// QA's own local D1 (Miniflare), independent of the implementer's test helpers.
// Schema is applied from db/schema.sql (the spec), so jobs are tested against the spec schema.
import { Miniflare } from 'miniflare';
import schemaSql from '../../db/schema.sql?raw';

export const TABLES = ['prices', 'fillups', 'alerts', 'runs', 'market_daily', 'settings', 'stations'];

export const VARS = {
  HOME_LAT: '59.93', HOME_LON: '10.80', FUEL: 'diesel', TANK_L: '50', CONSUMPTION_L100: '6.5',
  SENSITIVITY: 'normal', QUIET_HOURS: '22-07', ALLOWED_CHAT_IDS: '123456789',
};

export async function createQaDb() {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("") } }', d1Databases: ['DB'] });
  const DB = (await mf.getD1Database('DB')) as unknown as D1Database;
  const stmts = schemaSql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of stmts) await DB.prepare(s).run();
  return {
    mf,
    DB,
    env: { DB, ...VARS } as any,
    async reset() {
      for (const t of TABLES) await DB.prepare(`DELETE FROM ${t}`).run();
    },
    async all<T = Record<string, unknown>>(sql: string, ...binds: unknown[]): Promise<T[]> {
      const r = await DB.prepare(sql).bind(...binds).all<T>();
      return r.results ?? [];
    },
    async count(table: string, where = '1=1', ...binds: unknown[]): Promise<number> {
      const r = await DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...binds).first<{ n: number }>();
      return r?.n ?? 0;
    },
    dispose: () => mf.dispose(),
  };
}
export type QaDb = Awaited<ReturnType<typeof createQaDb>>;
