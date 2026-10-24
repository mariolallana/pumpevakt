# QA report: Phase 1 (collect data)

- **Branch:** `phase-1` (uncommitted working tree, 2026-10-24)
- **QA suite:** `test/qa/` (110 black-box tests). They import only the module paths and exports in `docs/phase-1-contract.md`, and use QA's own live-recorded and hand-written fixtures in `test/qa/fixtures/` plus QA's own Miniflare D1 built from `db/schema.sql` (`test/qa/qaDb.ts`).
- **Commands run:** `npm run typecheck` gave no errors. `npm test`: **7 files, 170 tests, 170 passed** (110 QA + 60 implementer unit). No test hits the network.

## Verdict: PASS WITH ISSUES

Every Phase 1 requirement that can be checked locally is met, and all 110 QA tests pass against the final implementation. Two defects that QA found during the parallel build (QA-BUG-1, QA-BUG-2) were fixed by the implementer before this report. The remaining issues are not code failures:
1. The Phase 1 exit criteria in docs/08 (prod D1 fills every 30 min, CPU per run measured, CI green on GitHub) can't be checked locally. Nothing has been deployed or pushed.
2. **The CPU budget is a real risk.** On Node, just parsing, mapping and deduping 3 × 100 live-shaped stations (3 × 261 KB) takes **~5–6 ms** (QA-PERF-01). The implementer measured the same (IMPL-1), against a 10 ms free-plan limit.
3. The specs have gaps that change behaviour (see `docs/spec-flaws-qa.md`). The most important: the 25 km "area" isn't covered by the three 12 km queries (QA-SPEC-1), and "failed run" is not defined (QA-SPEC-3).

## Fixtures (QA-owned, recorded 2026-10-24 with `User-Agent: pumpevakt/1.0 (github.com/mariolallana/pumpevakt)`)
| File | Origin |
|---|---|
| `drivstoffapp-oslo-centre.json` | Live `nearby?lat=59.9111&lng=10.7528&radius=12&limit=100&include_no_price=false`, trimmed to 15 stations in the real shape. Picked to include 3 with `fd_price` set, 2 with null diesel and HVO. Maps to 45 obs (13 diesel). |
| `fred-ddfuelnyh.csv` | Live `fredgraph.csv?id=DDFUELNYH&cosd=2026-08-01`: 57 rows, 1 blank (2026-09-07) |
| `norgesbank-usdnok.csv` | Live `EXR/B.USD.NOK.SP?format=csv&lastNObservations=30&locale=en`: 30 rows |
| `drivstoffapp-adversarial.json` | Hand-made: fd only, fd plus diesel, all-null, no `updated_at`, missing per-fuel key, 2.19, 75, stale (4 days), Drammen (~35 km), HVO only, and a duplicate of Fredensborg |
| `fred-adversarial.csv`, `fred-legacy-header.csv` | `.` and blank values, CRLF, trailing blank lines, old `DATE` header |
| Generated in `helpers.ts` | N synthetic fresh stations (for n ≥ 30), 3 × 100 live-shaped stations (size/perf), renamed-field and non-array bodies |

## Traceability matrix

Result: ✅ pass · ⚠️ pass with a caveat · ⛔ not testable locally (see Coverage gaps)

| # | Requirement (source) | Test(s) | Result |
|---|---|---|---|
| R1 | Oslo S = 59.9111, 10.7528 (04 shared defs) | QA-GEO-01 | ✅ |
| R2 | Haversine distance (02 §1, contract) | QA-GEO-02, 03 | ✅ |
| R3 | Median: empty→null, odd, even, no mutation, numeric sort (contract) | QA-MED-01…06 | ✅ |
| R4 | Oslo level: diesel, ≤ 25 km, fresh ≤ 6 h (inclusive), null if nFresh < 30 (04 shared defs) | QA-LVL-01…09 | ✅ |
| R5 | Oslo level opts override (contract) | QA-LVL-08 | ✅ |
| R6 | WDI = ULSD ÷ 3.78541 × USD/NOK, series `wdi_nok_l` (01 §3) | QA-WDI-01 | ✅ |
| R7 | FX carry-forward from latest earlier day, no look-ahead, skip if no FX yet (contract) | QA-WDI-02…06 | ✅ |
| R8 | Field mapping diesel/gasoline/octane/hvo100 → Fuel; station fields (01 §2) | QA-MAP-01…03 | ✅ |
| R9 | Per-fuel `updated_at` → `observedAt`, ISO UTC `…Z` (01 §2, contract) | QA-MAP-04, QA-JP-02 | ✅ |
| R10 | `fd_price` ignored everywhere (CLAUDE.md 2, 01 §4, 04 §2) | QA-MAP-05, 07, QA-DRV-05, QA-JP-05 | ✅ |
| R11 | Null prices / missing `updated_at` ignored, never a price without age (contract, CLAUDE.md 2) | QA-MAP-06, 08…10, 12 | ✅ |
| R12 | A format change makes the run fail (09 Monitoring) | QA-MAP-14, QA-JP-14, QA-JP-15 | ✅ (was ⛔ QA-BUG-1, fixed) |
| R13 | Dedupe by station id + fuel across centres (01 §2, contract) | QA-DED-01…03, QA-DRV-05, QA-JP-07 | ✅ |
| R14 | 3 centres, radius 12, limit 100, include_no_price=false, GET, https, ≤ 3 calls/run (01 §2, 02 §4) | QA-DRV-01, 02, QA-JP-01, QA-SCH-01 | ✅ |
| R15 | Honest User-Agent on drivstoffapp (and FRED / Norges Bank) (01 §2, CLAUDE.md 1) | QA-DRV-03, QA-FRED-04, QA-NB-03 | ✅ |
| R16 | Unauthenticated read endpoints only (01 §2) | QA-DRV-04, QA-SRC-02 | ✅ |
| R17 | 15 s timeout per call, all adapters (02 §4, 05 §4) | QA-TMO-01 (real 15 s wait), QA-DRV-07 | ✅ |
| R18 | HTTP errors from sources reject (09) | QA-DRV-06, QA-FRED-05, QA-NB-04 | ✅ |
| R19 | FRED CSV: skip `.` and blanks, CRLF, header variants (contract) | QA-FRED-01…03 | ✅ |
| R20 | FRED fetch: fredgraph.csv `id=DDFUELNYH` (01 §1) | QA-FRED-04, QA-JM-01 | ✅ |
| R21 | Norges Bank CSV → `usdnok` (contract) | QA-NB-01…03 | ✅ |
| R22 | Upsert stations (insert + update master data) (02 §4) | QA-JP-01, QA-JP-08 | ✅ |
| R23 | Change-only price inserts: price **or** `observed_at` changed (02 §4) | QA-JP-03, QA-JP-04 | ✅ (spec contradiction: QA-SPEC-4) |
| R24 | Prices stored with `source='drivstoffapp'`, FK to stations (03 schema) | QA-JP-02 | ✅ |
| R25 | Implausible prices (2.19, 75) don't break the run and aren't stored (schema CHECK 5..60, 04 §6.5) | QA-JP-06 | ✅ (spec gap: QA-SPEC-5) |
| R26 | Level computed per run, `oslo_diesel_median` written only if nFresh ≥ 30 (02 §4, 04) | QA-JP-09, 10, 11 | ✅ |
| R27 | Daily level = median of all L values that day (04) | QA-JP-12 | ✅ (spec gap: QA-SPEC-2) |
| R28 | Full-size run (3 × 100 stations, ~900 obs) stores everything (02 §5 D1 limits) | QA-JP-16 | ✅ |
| R29 | Market job stores `ulsd_usd_gal`, `usdnok`, `wdi_nok_l`, idempotently (02 §4, 03) | QA-JM-01, 02, 04 | ✅ |
| R30 | `runs` pruned to 30 days by the market job (03 Retention) | QA-JM-03 | ✅ |
| R31 | Market source failure / HTML-200 is a failed run (09) | QA-JM-05, 06 | ✅ |
| R32 | `scheduled()` dispatches `*/30 * * * *` → prices, `30 6 * * *` → market (contract, 05 §3) | QA-SCH-01, 02 | ✅ |
| R33 | Every run writes a `runs` row, on success (ok=1) **and** failure (ok=0 + error) (02 §4.5, 08) | QA-SCH-01…04, QA-JP-13, 14 | ✅ |
| R34 | `GET /health` → `{jobs:{prices:{lastOk,lastError,nFresh},market:{…}}}` incl. no-runs case (05 §2) | QA-HTTP-01, 02, 04 | ⚠️ keys match. Types not specified (QA-SPEC-6). `lastError` is an object `{at,error}` |
| R35 | Read-only, no personal data on HTTP; unknown route 404 (05 §2, 09) | QA-HTTP-03 | ✅ |
| R36 | wrangler.toml crons exactly as docs/05 §3 | QA-CFG-02 | ✅ |
| R37 | wrangler.toml `main`, D1 binding `DB`, `migrations_dir` (02 §6, 08) | QA-CFG-01, 03 | ✅ (`database_id` is a placeholder, see QA-SPEC-12) |
| R38 | `[vars]` has every docs/03 config key; secrets not in vars | QA-CFG-04, 05 | ✅ |
| R39 | Migration 0001 = db/schema.sql (08 Phase 1) | QA-MIG-01, 02 | ✅ |
| R40 | ci.yml runs `npm ci`, typecheck, test on push/PR (02 §2, 08) | QA-CI-01 | ✅ (not run on GitHub) |
| R41 | deploy.yml: typecheck + test, `d1 migrations apply --remote`, `wrangler deploy`, token from secrets | QA-CI-02…04 | ✅ (not run) |
| R42 | No secrets committed; `.dev.vars` / `.env*` ignored (09, CLAUDE.md 5) | QA-SEC-01…04 | ✅ (was ⛔ QA-BUG-2, fixed) |
| R43 | ESM, TS strict, `npm test` / `npm run typecheck`, vitest picks up test/qa (contract) | QA-PKG-01…03 | ✅ |
| R44 | No runtime dependencies beyond the stack (CLAUDE.md KISS) | QA-PKG-04 | ✅ (devDep `miniflare` added: justified in test/unit/README) |
| R45 | Only open, keyless hosts in src/ (CLAUDE.md 1) | QA-SRC-02 | ✅ |
| R46 | All contract modules exist | QA-SRC-01 | ✅ |
| R47 | Worker CPU ≤ 10 ms per invocation (02 §5, CLAUDE.md 4, 08 exit) | QA-PERF-01 (Node indicator only) | ⚠️ ~5–6 ms for parse + map alone, see Risks |
| R48 | Prod D1 fills every 30 min; CI green; deployed and checked on phone (08 exit, DoD) | — | ⛔ |
| R49 | ~150 drivstoffapp requests/day (00 §4, 09) | QA-DRV-02 (3/run) × 48 crons/day = 144 | ✅ by construction |
| R50 | Two consecutive failures → Telegram ⚠️ (02 §4.5) | — | n/a (Phase 2 per 08; QA-SPEC-13) |

## Bugs

| ID | Severity | Status |
|---|---|---|
| QA-BUG-1 | **High** | Fixed by the implementer during QA (re-verified) |
| QA-BUG-2 | Low | Fixed by the implementer during QA (re-verified) |
| QA-BUG-3 | Low | Open |
| QA-BUG-4 | Low | Open (spec gap) |

### QA-BUG-1 (High, fixed): a source format change was recorded as a successful run with no data
- **Repro (first implementation, ~12:58):** `mapStations({error:'changed'})` returned `[]` instead of throwing. `runPricesJob` with a drivstoffapp body of `{"items":[…]}`, or with an array whose `prices` field had been renamed, resolved with `{nObs:0,nChanges:0}`, no `error`, and `runs.ok = 1`. Tests: QA-MAP-14, QA-JP-14, QA-JP-15.
- **Expected (docs/09 Monitoring; docs/00 §5 "zero days with a silent data failure"):** the mapping throws, and the run counts as failed, which drives the ⚠️ ping.
- **Actual now:** `mapStations` throws on a non-array. `fetchDrivstoffapp` throws when a non-empty array maps to 0 obs. The run is `ok = 0` with `detail.error`. All three tests pass.

### QA-BUG-2 (Low, fixed): `.gitignore` rewrite dropped `.env*`
- **Repro (mid-build):** `git diff .gitignore` showed `.env*`, `!.env.example`, `coverage/` and others removed and replaced by `.wrangler/`, `.dev.vars` and `*.log`.
- **Expected (docs/09 Security, CLAUDE.md rule 5):** local secret files are never committed. Wrangler 4 also reads `.env` for local secrets.
- **Actual now:** the original entries are restored and `.dev.vars` / `.wrangler/` are added. QA-SEC-01 and QA-SEC-04 pass.

### QA-BUG-3 (Low, open): a caller's `signal` replaces the 15 s timeout in `fetchDrivstoffapp`
- **Repro:** read the code. `signal: signal ?? AbortSignal.timeout(15000)`. If a caller passes an `AbortSignal`, the request has no timeout unless that signal fires. Not triggered today, because the jobs never pass a signal.
- **Expected (docs/02 §4 "15 s timeout each"):** the timeout always applies, combined with any caller signal (`AbortSignal.any([signal, AbortSignal.timeout(15000)])`).
- **Impact:** none in the current code paths. It's a trap for Phase 2+.

### QA-BUG-4 (Low, open / spec gap): future `observed_at` counts as fresh
- **Repro:** `osloLevel` skips an observation only if `now − t > 6 h`. A timestamp hours in the future (source clock skew) counts as fresh indefinitely until it is in the past.
- **Expected:** not specified (QA-SPEC-9). The suggestion is to clamp to `now` or reject anything more than about 10 minutes in the future.

## Risks and observations (not counted as bugs)
- **CPU (High risk for the Phase 1 exit):** QA-PERF-01 on Node 20: `JSON.parse` + `mapStations` + `dedupeObs` over 3 × 261 KB takes a **median of 5.9 ms** (best 5.2 ms). The implementer measured 4.4 ms warm / ~8 ms cold. D1 serialisation comes on top. The 10 ms free-plan limit could be exceeded on cold starts. This has to be measured with `wrangler tail` after the first deploy. If it doesn't fit, use the docs/02 §5 fallback.
- **All-or-nothing centres:** if any one of the three drivstoffapp calls fails, the whole prices run fails and stores nothing (IMPL-5, chosen deliberately). It's safe, but one flaky centre loses the whole 30-minute sample. It's a spec decision (QA-SPEC-3).
- **Coverage:** the recorded centre call had only 9 diesel prices fresh within 6 h. The level depends on all three centres together reaching n ≥ 30. The implementer's live smoke run reported 75. See QA-SPEC-1.
- **Implausible but in-range prices are stored** (live: petrol98 18.66 at Esso Trondheimsveien). Fine for Phase 1. They need a rule before `/near` (Phase 2).
- **`database_id` placeholder** in wrangler.toml: deploy.yml fails until `wrangler d1 create` has been run and the ID pasted in (QA-SPEC-12).
- `/health` returns `lastError` as `{at, error}`. docs/05 doesn't define the type, so the Phase 3 weekly check has to be written against this shape.

## Coverage gaps (couldn't be tested locally)
- Real deploy, real cron firing on Cloudflare, prod D1 filling every 30 min (docs/08 exit).
- Worker CPU time in workerd (`wrangler tail`). Node timing is only an indicator.
- The real D1 free-plan limits (queries per invocation, bound parameters, 5M reads/day). Miniflare doesn't enforce them all. QA-JP-16 shows the bulk-write path works at full size.
- GitHub Actions actually running (ci.yml / deploy.yml were checked statically only), and Dependabot (docs/09) is not configured. Not a Phase 1 deliverable in docs/08.
- `wrangler d1 migrations apply --remote` against a real database.
- Live source drift after 2026-10-24. Re-record with `scripts/probe-sources.mjs`.
- Behaviour under real network timeouts in workerd (`AbortSignal.timeout`). Tested only with Node's implementation and a hanging fake fetch.
- `/health` staleness logic and the failure ping (Phase 2/3).
