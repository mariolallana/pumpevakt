# CLAUDE.md: standing instructions for AI agents

Pumpevakt is a single-user Telegram bot (with a later read-only dashboard) for Oslo fuel prices. It sends market alarms from open data (the Wholesale Diesel Index) and station prices once a source is unlocked. **The specs in `docs/` are the source of truth.** Read the relevant doc first, and update it in the same PR if behaviour changes. Log design decisions in `docs/10-design-review.md`.

## Principles: KISS, always
- One Worker, one D1 database, one language. Don't add services, frameworks or tables without a design-review entry.
- One user. No auth, profiles or multi-tenancy. Config lives in `wrangler.toml` vars.
- All logic in `src/core/` as pure, tested TypeScript. No business logic in SQL.
- Build only what is ungated (docs/01 §4). Gated features wait for their unlock.

## Stack
Cloudflare Workers + D1 · TypeScript strict · grammY · Vitest · Wrangler · GitHub Actions. Phase 4 only: Vite + React + Tailwind + shadcn/ui + MapLibre/OpenFreeMap on Cloudflare Pages.

## Rules
1. **Data:** only the sources marked allowed in docs/01. Never reverse-engineer private APIs, mint tokens, bypass App Check, robots.txt or anti-bot measures. Always attribute ODbL, SSB, FRED and Norges Bank.
2. **Prices:** NOK/L incl. VAT with an `observed_at`. Never show a price without its age. Exclude tax-free diesel.
3. **Alerts:** idempotent `dedupe_key`, quiet hours, 3/day cap, shadow mode. Changing `signals.ts` requires the docs/04 §7 fixtures to pass.
4. **Worker CPU:** keep each invocation light (free plan, 10 ms CPU). Heavy parsing goes in GitHub Actions scripts.
5. **Secrets:** Wrangler or GitHub secrets only. Never commit `.dev.vars`.
6. Before finishing: `npm run typecheck && npm test`. Report failures honestly.
7. Small PRs, one phase each, conventional commits.

## Commands
- `node scripts/probe-sources.mjs`: check that all open sources are alive
- `npx wrangler dev`: local Worker · `npx wrangler deploy`
- `npx wrangler d1 migrations apply pumpevakt --remote`
- `npm test`: Vitest
