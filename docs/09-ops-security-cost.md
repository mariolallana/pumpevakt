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
- Station data © Drivstoffpriser contributors and OpenStreetMap contributors, **ODbL**. Attribute in bot footers and the dashboard. Share-alike applies only if we publish a derived database.
- SSB: CC BY 4.0. Norges Bank, FRED (public domain series), OpenVan (public API): attribute.
- No scraping of private APIs. See the rule in [01](01-data-sources.md).

## Cost
| Item | Monthly |
|---|---|
| Cloudflare Workers + D1 + Pages, GitHub, Telegram, all data sources | **0 NOK** |
| Google Places (only if the probe passes) | 0 within the free cap. Set a **budget alert at $1** |
| Photo extraction (later) | ~0–5 NOK |

Scale triggers: Worker CPU errors → move the job to Actions or the $5 Workers plan. More than 10 users → revisit auth.
