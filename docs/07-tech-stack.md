# 07 · Tech stack & vibe-coding toolkit

The criteria: free, popular enough that AI coding tools know it deeply, good taste out of the box, and a minimum of glue code.

## 1. Runtime stack

| Layer | Choice | Why this (and not the alternative) |
|---|---|---|
| Language | **TypeScript** everywhere (strict) | One language for web, functions and shared maths |
| Web framework | **Next.js 15** (App Router) | Best AI-tool fluency and a first-class Vercel deploy. (SvelteKit is nicer to hand-write, but AI tools are less fluent in it) |
| Styling / UI | **Tailwind CSS v4 + shadcn/ui** (Radix) | Accessible primitives, code you own, easy to restyle with our tokens |
| Bottom sheet | **vaul** | Native-feeling drawer with snap points |
| Map | **MapLibre GL JS** + **OpenFreeMap** tiles (`liberty` or `positron` style) | Free, no API key, vector and smooth. (Leaflet is simpler but raster, which looks dated) |
| Charts | **Recharts** (via shadcn charts) | Matches shadcn styling. Enough for line, step and heatmap (heatmap as a CSS grid) |
| Data fetching | **TanStack Query** + `@supabase/supabase-js` | Caching, background refresh, offline persistence |
| PWA | **Serwist** (`@serwist/next`) | The maintained successor of next-pwa |
| Backend | **Supabase**: Postgres 15, **PostGIS**, Auth (magic link), Edge Functions (Deno), `pg_cron`, `pg_net` | DB, cron, functions and auth on one free platform |
| Email | **Resend** + **React Email** | Free 3k/mo with nice templates |
| Chat alerts | **Telegram Bot API** (via `grammy` on Deno) | Free, instant push on every OS, and bot commands for free |
| Web Push (v1) | `web-push` VAPID from the Edge Function | Works on Android and desktop, and on iOS when installed |
| Geocoding | **Photon** (komoot) for address search | Free, OSM-based, no key. Respect fair use |
| Station seed | **OSM Overpass API** | `amenity=fuel` with brand tags. ODbL attribution |
| AI photo extraction (v1) | **Claude Haiku 5.5** (`claude-haiku-5-5`, vision) or Gemini Flash free tier | Reads a price-sign photo into JSON. A few cents a month at most |
| Hosting | **Vercel Hobby** (web) · **Supabase Free** (backend) | No PC needed, preview deploys on every PR |
| Tests | **Vitest** (unit, alert maths) · **Playwright** (e2e smoke on Find) | Fast and AI-friendly |
| Quality | ESLint (next config) + Prettier + `tsc --noEmit` + **Biome** optional | CI gate |
| Monorepo | **pnpm workspaces** (`apps/web`, `packages/core`, `supabase/`) | Shared types and maths without a build system |

## 2. Vibe-coding toolkit (late 2026)

| Tool | Role in this project |
|---|---|
| **Claude Code** (CLI and web at claude.ai/code) | Main builder. Reads `CLAUDE.md` and these docs, implements phases, runs tests, opens PRs. **Claude Code on the web** runs in the cloud against the GitHub repo, so you can build from any device without your PC |
| **v0.dev** (free credits) | Fast first drafts of screens in shadcn/Tailwind. Paste [06](06-ux-ui-spec.md) as context, then bring the code into the repo |
| **Supabase MCP server** | Lets Claude Code inspect the schema, run SQL and read logs during development |
| **GitHub** (`mariolallana/pumpevakt`) | Source of truth, Actions CI/CD, issues per phase |
| **Vercel ↔ GitHub integration** | Every PR gets a preview URL you can open on your phone |
| Lovable / Bolt.new | *Not recommended here.* They're great for throwaway prototypes, but they fight a custom Supabase schema plus edge-function architecture |

## 3. Versions policy
Pin exact versions in `package.json` (no `^` on frameworks). Upgrade on purpose, one PR per major. Node 20 LTS locally, matching Vercel's default.

## 4. Secrets (names only, values never in git)

| Name | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel env |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase function secrets, GitHub Actions secret (deploy/backup) |
| `CRON_SECRET` | Supabase function secrets + DB vault (used by pg_cron) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Supabase function secrets |
| `RESEND_API_KEY`, `ALERT_FROM_EMAIL` | Supabase function secrets |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (v1) | Vercel (public) / Supabase (private) |
| `PARTNER_API_KEY` (if Phase 0 succeeds) | Supabase function secrets |
| `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` (v1) | Supabase function secrets |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | GitHub Actions (deploy) |
