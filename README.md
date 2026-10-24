# Pumpevakt ⛽ — personal fuel-price watcher for Oslo

> Working name. *Pumpevakt* means "pump guard". The app finds the cheapest diesel or petrol near you and warns you when prices drop.

A small full-stack PWA that runs entirely on free tiers and never needs your PC switched on. It does three things:

1. **Find**: shows live diesel and petrol prices on a map and in a list, ranked by *real* saving (price minus the cost of the detour) within a radius of you.
2. **Market-drop alarm**: notifies you when the general price level around Oslo falls sharply compared with its recent history.
3. **Outlier alarm**: notifies you when one station around Oslo is priced well below the rest.

Alerts go to **Telegram** (instant, free), **email** (Resend) and, optionally, **Web Push**.

## Spec documents (read in order)

| # | Doc | What it decides |
|---|-----|-----------------|
| 00 | [Product requirements](docs/00-product-requirements.md) | Users, jobs-to-be-done, scope (MVP / v1 / later), success metrics |
| 01 | [Data sources & risk](docs/01-data-sources.md) | **Where prices come from.** This is the #1 project risk, so read it first |
| 02 | [Architecture](docs/02-architecture.md) | Components, free-tier budget, how it runs without your PC |
| 03 | [Data model](docs/03-data-model.md) + [SQL](supabase/migrations/0001_init.sql) | Postgres/PostGIS schema, views, retention |
| 04 | [Alert engine](docs/04-alert-engine.md) | Exact algorithms, thresholds, de-duplication, message formats |
| 05 | [API spec](docs/05-api-spec.md) | Edge functions, RPCs, ingestion adapter contract |
| 06 | [UX / UI spec](docs/06-ux-ui-spec.md) | Screens, design system, states, accessibility |
| 07 | [Tech stack & vibe-coding toolkit](docs/07-tech-stack.md) | Chosen tools, versions and why |
| 08 | [Build plan](docs/08-build-plan.md) | Phased milestones with ready-to-paste Claude Code prompts |
| 09 | [Ops, security & cost](docs/09-ops-security-cost.md) | Secrets, monitoring, limits, legal |
| — | [CLAUDE.md](CLAUDE.md) | Standing instructions for AI coding agents working in this repo |

## One-paragraph architecture

`Next.js PWA (Vercel)` ⇄ `Supabase (Postgres + PostGIS, Auth, Edge Functions, pg_cron)`. A `pg_cron` job calls the `ingest` edge function every 20 minutes. The function pulls prices from pluggable **source adapters**, writes append-only observations, refreshes area statistics, then runs the **alert engine**, which sends messages through Telegram and Resend. GitHub Actions runs a daily health check and a weekly backup. Everything runs in the cloud on free tiers.

## Status

Phase 0: specs written (2026-10-24). Next step: the **data-source spike** ([08 – Phase 0](docs/08-build-plan.md#phase-0--data-source-spike-go--no-go)).
