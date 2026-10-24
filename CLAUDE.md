# CLAUDE.md: standing instructions for AI agents

Pumpevakt is a personal PWA that finds the cheapest fuel near the user in Oslo and sends alerts on market drops and outlier stations. **The specs in `docs/` are the source of truth.** Read the relevant doc before changing a feature, and update the doc in the same PR if behaviour changes.

## Stack (do not swap without an ADR note in docs/02)
Next.js 15 (App Router, TS strict) · Tailwind v4 + shadcn/ui · MapLibre + OpenFreeMap · TanStack Query · Supabase (Postgres + PostGIS, Edge Functions on Deno, pg_cron) · Telegram (grammy) · Resend + React Email · Vitest · Playwright · pnpm workspaces.

## Layout
- `apps/web`: UI only. Talks to Supabase through RPCs and tables under RLS.
- `packages/core`: pure TS (types, alert maths, net saving). **No I/O.** 100 % unit-tested.
- `supabase/migrations`: numbered, append-only. Never edit an applied migration. Add a new one instead.
- `supabase/functions/*`: thin handlers. `_shared/adapters/*` implement `SourceAdapter` (docs/05 §4).

## Rules
1. **Data sources:** only use sources listed as allowed in docs/01. Never reverse-engineer private APIs, mint tokens, spoof clients or bypass robots.txt or anti-bot measures. If a source is unavailable, use the `mock` adapter and say so.
2. **Prices** are `numeric(6,2)` NOK/L incl. VAT. Always carry `observed_at`. Never show a price without its age. Exclude tax-free diesel.
3. **Alerts** must be idempotent (`dedupe_key`) and respect quiet hours, the daily cap and revalidation (docs/04 §5). Any change to the alert maths needs the docs/04 §7 fixtures passing.
4. **UI** uses the tokens in docs/06 §2. Prices use the mono tabular font. Every screen has loading, empty, stale and offline states. Check 375 px and 1440 px in light and dark.
5. **Secrets** never go in code or `NEXT_PUBLIC_*` (except the anon key). Names are listed in docs/07 §4.
6. Before finishing: `pnpm lint && pnpm typecheck && pnpm test`. Report failures honestly.
7. Small PRs, one phase or feature each. Conventional commits.

## Useful commands (once scaffolded)
- `pnpm dev`: web app · `supabase start`: local backend (Docker)
- `supabase db push`: apply migrations · `supabase functions deploy <name>`
- `pnpm test`: Vitest · `pnpm e2e`: Playwright
