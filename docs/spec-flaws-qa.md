# Spec flaws found by QA (Phase 1)

Gaps, contradictions and things that can't be tested in docs/00–10 (plus the Phase 1 contract), found while writing black-box tests for Phase 1. This file doesn't change any spec. Each item names a doc and section, the problem, its impact and a suggested fix.

| ID | Doc / section | Severity |
|---|---|---|
| QA-SPEC-1 | 01 §2, 02 §4 vs 04 Shared definitions | High |
| QA-SPEC-2 | 04 Shared definitions, 02 §4, 03 | High |
| QA-SPEC-3 | 09 Monitoring, 00 §5, contract | High |
| QA-SPEC-4 | 03 schema vs 02 §4 | Medium |
| QA-SPEC-5 | 03 schema CHECK, 04 §2 and §6.5, 01 §2 | Medium |
| QA-SPEC-6 | 05 §2 `/health` | Medium |
| QA-SPEC-7 | 01 §2 mapping, 03 schema | Medium |
| QA-SPEC-8 | 01 §2 dedupe | Low |
| QA-SPEC-9 | 04 Shared definitions (fresh) | Low |
| QA-SPEC-10 | 10 challenges 4–5 vs 04 §1 and 08 Phase 1 | Medium |
| QA-SPEC-11 | 08 Phase 1 exit, 02 §5 | Medium |
| QA-SPEC-12 | 08 "Before Phase 1", 02/09, wrangler config | Medium |
| QA-SPEC-13 | 02 §4 step 5 vs 08 Phase 2 | Low |
| QA-SPEC-14 | 01 §1/§3, 02 §4 market job | Low |
| QA-SPEC-15 | 03 `stations` (`city`, `active`), 05 §4 `Station` | Low |
| QA-SPEC-16 | phase-1-contract | Low |
| QA-SPEC-17 | 01 §2, CLAUDE.md rule 1 | Low |

---

### QA-SPEC-1: The "area" the Oslo level uses is wider than the area the fetch covers
- **Where:** docs/04 Shared definitions ("Area: stations within 25 km of Oslo S") vs docs/01 §2 and docs/02 §4 (three centres, Oslo west, centre and east, with `radius=12` and `limit=100` each).
- **Problem:** Three 12 km circles laid out west to east can't cover a 25 km disc. Nothing more than about 12 km north or south of the centre line is ever fetched. Ski (~24 km S), Kolbotn, Lillestrøm and Gjelleråsen sit inside the "area" but outside every query circle. Also, `limit=100` can cut off the dense centre circle without anyone noticing. The "95 of 100 stations within 25 km" figure in docs/01 came from a single `radius=25` call (`scripts/probe-sources.mjs`), not from the production query pattern.
- **Impact:** L is the median of an inner-city sample, not the 25 km area the docs describe. `n_fresh` is lower than the feasibility numbers suggest, so the 30-station coverage guard may trip more often than expected (the recorded centre fixture had only 9 of 13 diesel prices fresh within 6 h). Truncation by `limit` can't be seen.
- **Fix:** Either define the area as "the union of the query circles", or pick centres and radii that actually cover 25 km (and say what to do when a call returns exactly `limit` rows, e.g. log `truncated: true` in `runs.detail`). Re-run the coverage probe with the production query pattern.

### QA-SPEC-2: Daily level: where intra-day L values are kept, and which time zone a "day" uses
- **Where:** docs/04 ("Daily level: median of all L values that day"), docs/02 §4 step 3 ("update today's `oslo_diesel_median`"), docs/03 (no table for per-run L).
- **Problem:** (a) The schema has nowhere to store per-run L values, so "median of all L values that day" can't be recomputed unless they're kept somewhere that isn't specified. docs/02's wording ("update today's value") also reads like "overwrite with the latest L". (b) The time zone of "day" is undefined. docs/04 dedupe keys use `{oslo_date}`, but `market_daily.day` for FRED and Norges Bank is a source (US or Norwegian business) date. Between 22:00 and 00:00 UTC the UTC date and the Oslo date differ.
- **Impact:** Two reasonable implementations give different B (the 14-day baseline) and therefore different alarms. Can't be tested without guessing. (The implementer stored L in `runs.detail` and used Europe/Oslo dates. That's sensible, but it ties alarm history to a log table that is pruned after 30 days. Fine for a 14-day window, but fragile.)
- **Fix:** State "day = Europe/Oslo calendar date" for `oslo_diesel_median`, and say where L per run lives (e.g. `runs.detail.level`, or a `market_intraday` series). Change docs/02 §4 to "recompute today's median of L".

### QA-SPEC-3: What counts as a failed run is not defined
- **Where:** docs/09 Monitoring ("The adapter's mapping throws → counts as a failed run"), docs/00 §5 ("Zero days with a silent data failure"), contract (`mapStations` "ignores … null prices, missing updated_at").
- **Problem:** Nothing says whether these are failures: (a) one of the three centres errors or times out, (b) a 200 response that isn't the expected array, (c) an array where no record maps (fields renamed), (d) `n_fresh < 30`, or (e) FRED answering 200 with an HTML page. The contract's "ignore bad records" can be read as "silently return nothing". During QA the first implementation did exactly that: a non-array body produced a successful run with 0 observations. The implementer then changed it.
- **Impact:** Silent data loss that never triggers the ⚠️ ping, which breaks the PRD success metric.
- **Fix:** Add a short "failure = …" list to docs/09. Suggested: any HTTP error or timeout, any non-array body, or 0 mappable observations from a non-empty response is a failed run. Decide explicitly whether a run with 1–2 of 3 centres is OK or partial (e.g. `ok=1` with `detail.partial`).

### QA-SPEC-4: The change-only rule contradicts itself
- **Where:** db/schema.sql and docs/03 ("a row is written only when the price for (station, fuel) changes") vs docs/02 §4 step 2 ("only if the price **or `observed_at`** changed").
- **Problem:** One says price only, the other says price or timestamp. It also doesn't say what the comparison is against: the latest row by `observed_at` or by insertion? And what if the source returns an *older* `observed_at` than the one stored (a rollback)?
- **Impact:** Row growth differs (re-confirmations at the same price are frequent). `/near` "age" depends on it: with price-only storage the shown age is the age of the first sighting, which is too old.
- **Fix:** Pick one (price or `observed_at` is needed for honest ages) and update the schema comment. Say "compared with the newest stored row by `observed_at`", and that older `observed_at` values are ignored.

### QA-SPEC-5: Implausible prices: where they are rejected isn't specified
- **Where:** schema `CHECK (price BETWEEN 5 AND 60)`, docs/04 §2 plausibility (`price < 0.6 × L`, alerts only), docs/04 §6 fixture 5 ("Price 2.19 → rejected"), docs/01 §2 mapping (no range rule).
- **Problem:** No doc says the adapter or job must drop prices outside 5–60. If it doesn't, one community typo (2.19, or 75) makes the bulk insert fail on the CHECK constraint, and the whole run fails or is lost. The 0.6 × L rule and the 5–60 rule overlap with no stated order.
- **Impact:** One bad crowd-sourced price can block all data collection. QA tested that the run survives (QA-JP-06, passes), but that behaviour isn't required anywhere.
- **Fix:** In docs/01 §2 mapping, add "drop prices outside 5–60 NOK/L (schema range)". Keep 0.6 × L as the alert-time rule.

### QA-SPEC-6: `/health` is under-specified and its phase is unclear
- **Where:** docs/05 §2 (`{ jobs: { prices: {lastOk, lastError, nFresh}, market: {…} } }`), docs/09 ("A stale `lastOk` fails the workflow"), docs/08 (the `/health` *route* isn't mentioned for any phase. Phase 2 has the `/health` *command*, Phase 3 adds weekly.yml).
- **Problem:** No types (is `lastError` a timestamp, a message or an object?). Nothing says what to return when there are no runs, what `market: {…}` contains, what "stale" means (how many hours), whether a run that never finished counts as an error, or what HTTP status to use when unhealthy (the weekly Action has to detect failure, and a 200 with a body needs parsing).
- **Impact:** You can't write a test that gives the same answer for every reasonable implementation, and the weekly check can't be written until it's decided. QA only checked the key names.
- **Fix:** Give a JSON example with types, define "stale" (e.g. prices `lastOk` older than 2 h, or market older than 48 h), and either return 503 when stale or document the `jq` check weekly.yml will use. Put the route in a phase.

### QA-SPEC-7: The `observed_at` format isn't normalised in the spec
- **Where:** docs/01 §2 (the source sends `"2026-10-24 07:26:46.000Z"`, with a space), db/schema.sql ("ISO-8601 UTC strings"), contract (`'...Z'`).
- **Problem:** The source format isn't strict ISO-8601. The docs never say to convert it. Change detection, `ORDER BY observed_at` and "≤ 6 h" comparisons work on strings, and mixed formats sort wrongly (`' '` < `'T'`).
- **Impact:** Duplicate inserts, or wrong "latest" rows, if formats ever mix.
- **Fix:** docs/01 §2: "normalise `updated_at` to `YYYY-MM-DDTHH:MM:SS.sssZ`".

### QA-SPEC-8: No rule for which duplicate wins across centres
- **Where:** docs/01 §2 ("dedupe by station `id`").
- **Problem:** The same station can come back from two centres with different data (a cache, or a price that changed between calls). No rule says which one to keep.
- **Fix:** "Keep the observation with the newest `observed_at`." The implementer already does this.

### QA-SPEC-9: Freshness edge cases
- **Where:** docs/04 ("Fresh price: observed ≤ 6 h ago"), docs/00 §4 ("Prices > 24 h old are never ranked").
- **Problem:** Nothing about timestamps in the future (source clock skew). The implementation counts them as fresh. There are two thresholds (6 h for "fresh" in the level and alarms, 24 h for ranking), and docs/05 `/near` says "using fresh prices" without saying which one.
- **Fix:** Say future timestamps are clamped to `now` (or rejected beyond +10 min), and name the two thresholds (`FRESH_H = 6`, `RANKABLE_H = 24`).

### QA-SPEC-10: The design review contradicts the alert spec and the build plan
- **Where:** docs/10 challenge 4 ("Market rule = 5-day change + 30-day median"), challenge 5 ("historical replay of the rule over 2015→today (**Phase 1 deliverable**)") vs docs/04 §1 (14-day median of daily levels, persistence) and docs/08 Phase 1 (no replay).
- **Impact:** It's unclear whether Phase 1 is "done" without the replay. The design review describes a rule that no longer exists.
- **Fix:** Mark challenges 4–5 as superseded by v3, or add the replay to docs/08 (as an explicit non-goal or a deliverable).

### QA-SPEC-11: The CPU exit criterion has no pass/fail threshold and no place to record it
- **Where:** docs/08 Phase 1 exit ("CPU per run is measured"), docs/02 §5 (10 ms free-plan limit, "should fit").
- **Problem:** "Measured" isn't a pass criterion, and nothing says where the measurement goes. CI can't check it, because Node timing isn't workerd CPU time. QA's Node-only indicator: parse + map + dedupe of 3 × 100 live-shaped stations takes a few ms (see the QA-PERF-01 log). That's a meaningful share of the 10 ms budget before any D1 work.
- **Fix:** "p95 CPU per prices run from `wrangler tail` ≤ 8 ms, recorded in docs/02 §5 with the date. Otherwise apply the documented fallback."

### QA-SPEC-12: Deployment prerequisites are missing
- **Where:** docs/08 "Before Phase 1" (Cloudflare account + Telegram bot only), docs/02 (deploy.yml), docs/09.
- **Problem:** Nothing mentions `wrangler d1 create pumpevakt` and pasting the `database_id` into `wrangler.toml`, the GitHub secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` (and the token's scopes: Workers Scripts edit, D1 edit), or which branch deploy.yml runs on.
- **Impact:** The first deploy fails. The Phase 1 exit ("prod D1 fills every 30 min") can't be reached by following the docs.
- **Fix:** Add these steps to the docs/08 "Before Phase 1" checklist and to docs/09 Security (secret names and scopes).

### QA-SPEC-13: Phase 1 vs Phase 2 for the failure ping
- **Where:** docs/02 §4 step 5 (prices job: "Two consecutive failures → Telegram ⚠️") vs docs/08 Phase 2 ("Two failed runs in a row → ⚠️ message").
- **Problem:** The job description includes the ping, but the build plan puts it in Phase 2. During Phase 1, failures can only be seen in `runs` and `wrangler tail`, so the "zero silent failures" metric isn't met in Phase 1.
- **Fix:** Say so explicitly in docs/08 Phase 1 (e.g. "no failure ping until Phase 2; check `/health` manually").

### QA-SPEC-14: The market job's data window and revision rules aren't specified
- **Where:** docs/01 §1/§3, docs/02 §4 (06:30 UTC WDI job).
- **Problem:** No doc says how much FRED and Norges Bank history to fetch per run, whether revised values overwrite stored ones (`market_daily` primary key means upsert, but that isn't stated), or what "−0.71 in 5 days" means (calendar days or business days). WDI needs a USD/NOK value on or before the first ULSD day, so the first ULSD days of any window get no WDI unless the FX window starts earlier.
- **Fix:** "Fetch the last 60 days of both, upsert (latest value wins), and make the FX window start at least 7 days before the ULSD window." Also define "N days" as calendar days.

### QA-SPEC-15: Master-data columns with no source and no rule
- **Where:** db/schema.sql `stations.city`, `stations.active`, docs/05 §4 `Station` (non-null `brand`, `address`).
- **Problem:** `city` is never mapped (it's available in `expand.city.name`). Nothing ever sets `active = 0` (closed or removed stations, or the API's `closed` / `is_active` flags). The adapter type requires string `brand`/`address`, but the schema allows NULL and the API can return null.
- **Fix:** Map `city` or drop the column. Decide whether `closed` / `is_active` should exclude a station. State that a null brand or address becomes `''`, or make the type nullable.

### QA-SPEC-16: Gaps in the contract (phase-1-contract.md)
- **Problem:** The contract never says where `Env` is exported from. It doesn't say whether a job that fails should throw or return (the implementation returns `{…, error}` and writes the `runs` row itself, while the contract comment puts "every run writes a `runs` row" in `src/index.ts`). It doesn't define what `nPoints` counts. And `fetchDrivstoffapp(fetchFn, signal)` doesn't say whether a caller's `signal` replaces the 15 s timeout or is combined with it (the implementation *replaces* it).
- **Fix:** Add `export interface Env` to `src/types.ts` in the contract. Specify "jobs never throw; they return `error` and write `runs`". Define `nPoints = rows upserted`. Specify "the signal is combined with the 15 s timeout (`AbortSignal.any`)".

### QA-SPEC-17: The User-Agent is only required for drivstoffapp
- **Where:** docs/01 §2, CLAUDE.md rule 1.
- **Problem:** The honest User-Agent is required for drivstoffapp.no only. docs/05 §4 lists adapter rules (15 s timeout, fixture) but not the User-Agent. FRED and Norges Bank etiquette isn't stated.
- **Fix:** Add "all adapters send the project User-Agent" to docs/05 §4. The implementation already does.
