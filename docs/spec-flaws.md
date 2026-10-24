# Spec flaws & gaps: consolidated (Phase 1, 2026-10-24)

The implementer and QA agents found these independently. **The specs (docs/00–10) were not edited.** This file is the backlog for a spec revision.

Details:
- [spec-flaws-impl.md](spec-flaws-impl.md) covers IMPL-n, including what the code chose for now.
- [spec-flaws-qa.md](spec-flaws-qa.md) covers QA-SPEC-n.
- [qa-report-phase-1.md](qa-report-phase-1.md) has the traceability matrix.

## Must fix before Phase 3 (alarms depend on these)

| # | Problem | Found by | Current behaviour in code |
|---|---|---|---|
| F1 | **Coverage:** three 12 km centres don't cover the 25 km area, and `limit=100` can silently truncate results. The "95/100 fresh" figure came from a single 25 km call, not the real query pattern | IMPL-2, QA-SPEC-1 | 150 unique stations collected in the live smoke run, with 75 fresh diesel prices (≤ 6 h) |
| F2 | **Daily Oslo median is undefined:** the schema has nowhere to keep the per-run values, and the time zone of a "day" isn't stated | IMPL-3, QA-SPEC-2 | Per-run level is stored in the `runs.detail` JSON. The day is in Europe/Oslo |
| F3 | **"Failed run" is undefined:** one centre down, an empty response, nothing mappable, or an HTML 200 | IMPL-5, QA-SPEC-3 | Any failure fails the run. A non-empty response that maps to nothing also fails. Jobs never throw; they log `ok=0` |
| F4 | **The future vs fresh vs rankable windows** (6 h / 24 h) are unnamed and overlap. Prices with a timestamp in the future count as fresh | QA-SPEC-9, QA-BUG-4 | Future timestamps are accepted as fresh |
| F5 | **docs/10 contradicts docs/04 and docs/08:** a 5-day/30-day WDI rule vs a 14-day Oslo median, and a historical replay listed as a Phase 1 deliverable | QA-SPEC-10 | Follows docs/04 and docs/08 |

| F19 | **Daily price jump makes "fresh" prices wrong (found in user testing, 2026-10-24).** Oslo diesel jumped about 3 kr/L around 12:00 UTC (median of updates 10–12 UTC was 24.43; after 12 UTC it was 27.45). The 6 h "fresh" window kept pre-jump prices, so the app showed an Oslo average of ~24.7–25.2 and old 22–24 kr "deals" while real prices were ~27.5–28.6 | User test | **Hotfix shipped:** `src/core/priceJump.ts`. A price more than 2 h old and ≥ 1 kr below the median of the last 2 h (needs ≥ 10 recent prices) counts as outdated: it's left out of the Oslo level and greyed and ranked last in the list. Recent cheap prices are kept. Specs (docs/01 §4, docs/04 shared definitions) should adopt this rule |

## Should fix (precision and ops)

| # | Problem | Found by |
|---|---|---|
| F6 | **CPU:** real responses are about 262 KB (2.6× the assumption). A run takes ~5 ms warm and ~9 ms cold against the 10 ms free limit. There's no pass threshold or place to record it | IMPL-1, QA-SPEC-11 |
| F7 | **Insert rule:** schema says "price changes", docs/02 says "price or `observed_at` changes" | QA-SPEC-4 |
| F8 | **Price bounds (5–60):** where they're enforced is unspecified. Implausible values (e.g. 98 octane at 18.66) and closed stations aren't handled | IMPL-9, QA-SPEC-5 |
| F9 | **`/health` shape** isn't specified: no types, no "no runs yet" case, no stale threshold | IMPL-4, QA-SPEC-6 |
| F10 | **Timestamp format:** the source sends `"YYYY-MM-DD hh:mm:ss.sssZ"`, and the spec doesn't say to normalise it to ISO | IMPL-8, QA-SPEC-7 |
| F11 | **Duplicate stations** across centres: no rule for which copy wins | QA-SPEC-8 |
| F12 | **Nullable fields:** brand is missing on ~8 % of stations. `stations.city` and `active` are never filled. Types disagree with the schema | IMPL-7, QA-SPEC-15 |
| F13 | **History window:** how much FRED / Norges Bank history to fetch, and how revisions are handled | QA-SPEC-14 |
| F14 | **Deploy prerequisites** missing: `wrangler d1 create`, `database_id`, secrets and their scopes | QA-SPEC-12 |
| F15 | **The two-failures ping** is described for the prices job (docs/02) but scheduled for Phase 2 | QA-SPEC-13 |
| F16 | **D1 free-plan statement limit** per invocation isn't in the budget table | IMPL-6 |
| F17 | **User-Agent rule** only stated for drivstoffapp, not FRED or Norges Bank | QA-SPEC-17 |
| F18 | **Contract gaps:** where `Env` lives, throw vs return on failure, what `nPoints` counts | QA-SPEC-16 |

## Tooling notes (not spec flaws)
- IMPL-10: Node 20 is end-of-life and limits wrangler and vitest versions. Recommend moving to Node 22.
- IMPL-11: the Worker entry file must not have named exports, so routes live in `src/routes.ts`.
- IMPL-12: tsconfig uses plain `strict` so the QA suite typechecks.
