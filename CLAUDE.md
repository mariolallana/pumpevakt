# CLAUDE.md: standing instructions for AI agents

Pumpevakt is a single-user Telegram bot (with a later read-only dashboard) for Oslo fuel prices. It offers best deal near me, a market-drop alarm and a cheap-station alarm, all built on open, keyless endpoints. **The specs in `docs/` are the source of truth.** Read the relevant doc first, and update it in the same PR if behaviour changes. Log design decisions in `docs/10-design-review.md`.

## Principles: KISS, always
- One Worker, one D1 database, one language. Don't add services, frameworks, tables or dependencies without a design-review entry.
- One user. No auth, profiles or multi-tenancy. Config lives in `wrangler.toml` vars.
- All logic in `src/core/` as pure, tested TypeScript. No business logic in SQL.

## Stack
Cloudflare Workers + D1 · TypeScript strict · grammY · Vitest · Wrangler · GitHub Actions. Phase 4 only: Vite + React + Tailwind + shadcn/ui + MapLibre/OpenFreeMap on Cloudflare Pages.

## Rules
1. **Data:** only the open, keyless sources in docs/01. Use only the unauthenticated read endpoints of drivstoffapp.no, poll at most every 30 min (3 calls), send the project User-Agent and always attribute. No paid APIs, no partnerships, no scraping of websites.
2. **Prices:** NOK/L incl. VAT with `observed_at`. Never show a price without its age. Ignore tax-free diesel (`fd_price`).
3. **Alerts:** idempotent `dedupe_key`, quiet hours, 3/day cap, shadow mode. Changing `signals.ts` requires the docs/04 §6 fixtures to pass.
4. **Worker CPU:** keep each invocation light (free plan, 10 ms CPU). Measure with `wrangler tail`.
5. **Secrets:** Wrangler or GitHub secrets only. Never commit `.dev.vars`.
6. Before finishing: `npm run typecheck && npm test`. Report failures honestly.
7. Small PRs, one phase each, conventional commits.

## Commands
- `node scripts/probe-sources.mjs`: check that all sources are alive
- `npx wrangler dev` · `npx wrangler deploy` · `npx wrangler tail`
- `npx wrangler d1 migrations apply pumpevakt --remote`
- `npm test`
