# 09 · Ops, security & cost (lean v2)

## Monitoring (no PC needed)
| Signal | Mechanism |
|---|---|
| A job failed twice in a row | The Worker sends Telegram ⚠️ itself |
| The Worker itself is dead (no cron running) | Weekly GitHub Action curls `/health`. A stale `lastOk` fails the workflow and GitHub emails me |
| Source changed format | The adapter's mapping throws → counts as a failed run → ⚠️ |
| Live logs | `wrangler tail` or the Cloudflare dashboard |

## Backups
Weekly `wrangler d1 export` → GitHub Actions artifact (90 days). Restore = `wrangler d1 execute --file`.

## Security
- The bot answers only `ALLOWED_CHAT_IDS`. The webhook verifies `X-Telegram-Bot-Api-Secret-Token`.
- No user accounts, so there's no auth surface. The `/api/*` routes are read-only and expose no personal data.
- Secrets only in Wrangler secrets or GitHub secrets. Never commit `.dev.vars`.
- Shared Telegram locations are used in memory for the reply and not stored.
- Dependabot for npm and Actions.

## Legal & attribution
- Station prices: drivstoffapp.no public API (no published terms). Attribute in every message, poll gently (≤ 150 requests/day), use only unauthenticated read endpoints. If they ever publish terms or ask us to stop, comply, and fall back to the market alarms on FRED/Norges Bank.
- Map tiles © OpenStreetMap contributors (ODbL).
- SSB: CC BY 4.0. Norges Bank and FRED (public domain series): attribute.
- No scraping of private APIs. See the rule in [01](01-data-sources.md).

## Cost
| Item | Monthly |
|---|---|
| Cloudflare Workers + D1 + Pages, GitHub, Telegram, all data sources | **0 NOK** |

Scale triggers: Worker CPU errors → move the job to Actions or the $5 Workers plan. More than 10 users → revisit auth.
