# 09 · Ops, security & cost

## 1. Monitoring (no PC required)

| Signal | How | Alert to |
|---|---|---|
| Ingest stale (> 2 h since a successful run) | GitHub Actions `watchdog.yml` daily, plus an in-app banner | Telegram (admin chat) |
| Adapter failing 3 runs in a row | `evaluate_alerts` writes a `system` alert event | Telegram |
| Coverage drop (`n_fresh` < guard) | Logged per run, and the watchdog summarises it | Telegram (daily digest) |
| Notify failures | `alert_events.status='failed'` count | Watchdog |
| Supabase paused or near its limits | Watchdog pings the REST endpoint and checks DB size via SQL | Telegram |

Logs: Supabase function logs (7-day retention on free) and `ingest_runs` (30 days).

## 2. Backups
- Weekly `pg_dump` (schema plus data, about 10–50 MB) through GitHub Actions → stored as a workflow artifact (90 days). Optional: also push to a private Google Drive folder.
- Restore drill once, in Phase 5: `supabase db reset` locally + restore → app works.

## 3. Security checklist
- [ ] RLS enabled on **every** table (migration 0001 does this). Personal tables are scoped to `auth.uid()`.
- [ ] The service role key exists only in Supabase/GitHub secrets, never in `NEXT_PUBLIC_*`.
- [ ] Edge functions reject requests without `CRON_SECRET` or the Telegram secret token.
- [ ] Telegram linking uses a one-time code that expires after 15 min. The chat ID is never accepted from user input.
- [ ] Crowd input is rate-limited (≤ 20 reports per user per day) and runs through the plausibility guards.
- [ ] Location: GPS stays client-side. Only explicitly saved places are stored.
- [ ] Dependabot on, for npm and GitHub Actions.
- [ ] Any change to `SECURITY DEFINER` functions is reviewed. Prefer `SECURITY INVOKER`.

## 4. Legal & attribution
- **Price data:** only from sources with permission, open data or our own users ([01](01-data-sources.md)). Show the source and its "last updated" time in the UI.
- **OpenStreetMap/OpenFreeMap:** "© OpenStreetMap contributors" on the map and in Settings → Data sources.
- **SSB:** "Source: Statistics Norway (SSB), table 09654" on the Trends page. CC BY 4.0.
- **Privacy:** personal use only. If friends join: a short privacy note (what's stored, delete-account button), GDPR-friendly by design (EU region, data minimisation).
- Vercel Hobby is for non-commercial use only. If this ever earns money, move the web app to Cloudflare Pages or a paid plan.

## 5. Cost

| Item | Monthly |
|---|---|
| Supabase, Vercel, Resend, Telegram, OpenFreeMap, GitHub | 0 NOK |
| AI photo extraction (v1, optional) | ~0–5 NOK |
| Domain (optional, e.g. `pumpevakt.no` at ~150 NOK/yr) | ~12 NOK |
| **Total** | **0 NOK** (≈ 12 NOK with a domain) |

**Scaling triggers** (when to rethink): more than 50 users, more than 400 MB DB, or a source licence that requires a paid tier.
