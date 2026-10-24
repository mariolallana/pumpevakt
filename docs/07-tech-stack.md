# 07 · Tech stack & vibe-coding toolkit (lean v2)

## 1. Runtime

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Runtime and hosting | **Cloudflare Workers** (free): cron triggers, Telegram webhook, JSON API |
| Database | **Cloudflare D1** (SQLite) |
| Telegram | **grammY** (`grammy`, runs on Workers) |
| Tests | **Vitest** (with `@cloudflare/vitest-pool-workers` only if testing the Worker itself, plain Vitest for `src/core`) |
| CLI and deploy | **Wrangler** + GitHub Actions |
| Phase 4 web | **Vite + React**, Tailwind v4, shadcn/ui, MapLibre GL + OpenFreeMap, Recharts, on **Cloudflare Pages** |

Dependencies are deliberately few: `grammy`, `wrangler`, `vitest`, `typescript`. Everything else uses `fetch` and the standard library.

## 2. Vibe-coding toolkit

| Tool | Role |
|---|---|
| **Claude Code** (CLI, or web at claude.ai/code against the GitHub repo, so no PC is needed) | Builds each phase from the prompts in [08](08-build-plan.md), runs tests, opens PRs |
| **GitHub** `mariolallana/pumpevakt` | Source of truth. Actions for CI, deploy and the weekly jobs |
| **Cloudflare dashboard** | Logs (`wrangler tail`), D1 console, cron history |
| v0.dev (Phase 4 only) | First drafts of the two dashboard views, then ported in |

## 3. Secrets

| Name | Where |
|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | `wrangler secret put` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secrets (deploy, weekly) |

Config that isn't secret (home, fuel, tank, sensitivity, allowed chat IDs) lives in `wrangler.toml` `[vars]`.

## 4. Versions
Pin exact versions. Node 20 LTS for scripts and Actions. One PR per major upgrade.
