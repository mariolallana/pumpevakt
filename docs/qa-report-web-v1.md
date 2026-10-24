# QA report: web v1 (API + "Find" page)

- **Branch:** `web-v1` (uncommitted working tree, 2026-10-24). QA tested the implementer's code as it was after the last edits at about 14:25 local time.
- **QA suite:** three new files in `test/qa/`, with **120 tests**:
  - `netsaving.test.ts`: 10 pure tests with hand-computed expected values.
  - `web-api.test.ts`: 64 tests that call the Worker's default `fetch` with QA's own Miniflare D1 (`qaDb.ts`, spec schema), seeded with timestamps relative to a frozen `NOW` (`vi.useFakeTimers({toFake:['Date']})`).
  - `web-static.test.ts`: 46 tests covering config, build wiring, web source, the built bundle and computed token contrast.

  The 110 Phase 1 QA tests are unchanged. No test touches the network.
- **Commands run:**
  - `npm run typecheck` (`tsc` for the Worker and for `web/`): no errors.
  - `npm run build:web`: OK. `index` JS is 239 KB (75 KB gzip). `MapView` is lazy-loaded at 1,058 KB (286 KB gzip). `web/dist` totals 1.6 MB.
  - `npm test` (round 2, after `npm run build:web`): **12 files, 329 tests, 329 passed** (230 QA + 99 implementer unit).
- **UI:** checked in a real browser (Playwright MCP, Chromium) against `npx wrangler dev` on **port 8799**, not 8787, so QA didn't collide with the implementer's dev server. QA's dev server used an isolated D1 (`--persist-to` in QA's scratchpad) seeded with 25 synthetic stations around HOME, aged from 10 min to 25 h, plus 41 days of market data and prices runs. Checked at 375×812 and 1440×900, in light and dark. Screenshots are in `docs/screens/qa-*.png`.

## Round 2 (after the coordinator's decisions and IMPL-W11…W14)
The coordinator made two product decisions:
- `/api/stations` without `lat`/`lon` defaults to **Oslo S**, and HOME never appears in any API response or in the bundle.
- **Fresh (≤ 6 h) rows rank before stale rows**, then by netSaving desc (nulls last), then by price asc.

**Tests:**
- QA-API-V-22 now asserts `origin == {59.9111, 10.7528}` and that HOME is absent.
- New: QA-API-R-05 (HOME never appears in any `/api/*` response, with a distinctive HOME injected).
- New: QA-API-S-22 and S-23 (fresh before stale, including the null-saving case).
- New: QA-WEB-BUILD-06 (ci.yml builds before `npm test`).
- New: QA-WEB-SRC-08 (no "near home" copy).
- QA-WEB-DIST-05 is now a hard check (no `59.93` and no `HOME_*` in the bundle).

**Browser re-check:** 375×812, light and dark, fresh `wrangler dev`, no orphan listener on the port. Screenshots: `qa-r2-375-light-full.png`, `qa-r2-375-dark-full.png`, `qa-r2-375-dark-api-error.png`. Results:
- Age visible on 16/16 rows, distance on 16/16.
- **0** text nodes below 4.5:1 in either theme.
- Stale pills are `--ink-muted` on `--surface` (6.7:1 dark).
- The dark neutral pill is `#0E1112` on `#9AA3A5` (7.4:1).
- The error-state heading reads "Stations within 10 km".
- The first row ends at y = 638 px, so it's above the fold.
- Fresh rows come before stale rows.
- Copy reads "Near Oslo S".
- No app console errors. The only one was the deliberately forced 500.

**Bug status:** QA-BUG-W1, W2, W3, W4, W5, W7 and W9 are **fixed**. QA-BUG-W6 (map targets < 44 px) and W8 (no visible text label next to ▼/▲ in rows) are **open** (Low; the implementer deferred them, IMPL-W13). Nothing fails.

## Verdict: PASS WITH ISSUES (round 2: only Low issues left open; see above)

The API meets the contract in every respect QA could test. That covers shapes, defaults, validation, the 400 shape, Cache-Control, the 24 h and 6 h boundaries, latest-price-per-station, the docs/04 §3 net saving (hand-computed), the refPrice rules, the sort order, the market window and the `latest` block. It also holds end to end from a real prices-job run. Routing with static assets is correct. The page implements every contract element and state: fuel select, Near me with fallback, radius chips, median card, map pills linked to rows, list rows, the Navigate link, and the loading, empty, stale, error and source-down states. There are no console errors.

Two defects QA found during the parallel build were fixed before this report: the dark `--ink` token (QA-BUG-W1) and the age being cut off on phones (QA-BUG-W2). These remain open:
- **Accessibility:** greyed stale rows and the dark "at reference" pill fail WCAG AA contrast (W4, W5). Map pills are below the 44 px target (W6). Distance is still cut off in some rows at 375 px (W3).
- **Privacy:** `/api/stations` with no coordinates returns HOME (W7).
- **Spec level:** stale prices (6–24 h) are still ranked by saving. Diesel's reference price has no age limit. On a phone the answer sits below the fold. See the UX findings and QA-SPEC-W1…W14.

## Traceability matrix

Result: ✅ pass · ⚠️ pass with a caveat · ❌ open bug · ⛔ not testable locally

| # | Requirement (source) | Test / check | Result |
|---|---|---|---|
| W1 | `GET /api/stations` returns 200 JSON with every contract field and type (contract shapes) | QA-API-S-01 | ✅ |
| W2 | `Cache-Control: public, max-age=60` on `/api/stations` and `/api/market` (contract §1) | QA-API-S-02, QA-API-M-01, curl | ✅ (errors use `no-store`, see QA-SPEC-W13) |
| W3 | Defaults: radius 10, fuel diesel (contract §1) | QA-API-S-03 | ✅ |
| W4 | radius max 30: 30 accepted, 31 never served (contract §1) | QA-API-V-20, 21 | ✅ (31 → 400) |
| W5 | Bad params → `400 {"error":{"code":"BAD_INPUT","message"}}`, JSON (contract §1) | QA-API-V-01…11, 23, 24; QA-API-M-10…14 | ✅ |
| W6 | All four fuels accepted; `fd` / `gasoline` / unknown rejected (contract, CLAUDE.md 2) | QA-API-V-08…10, 25 | ✅ |
| W7 | Missing `lat`/`lon` (contract silent) | QA-API-V-22, QA-API-R-05 | ✅ round 2: defaults to Oslo S; HOME is never in any response (was ❌ QA-BUG-W7) |
| W8 | Only prices ≤ 24 h; exactly 24 h kept, 24 h + 1 min dropped (contract) | QA-API-S-04, 05, 07 | ✅ |
| W9 | `stale` = age > 6 h; exactly 6 h not stale (contract) | QA-API-S-04, 05 | ✅ |
| W10 | Latest price per station (newest `observed_at`), one row per station | QA-API-S-06, 07 | ✅ |
| W11 | `ageMinutes`, `observedAt` ISO, `generatedAt` ISO | QA-API-S-01, 08, OBS-03 | ✅ |
| W12 | `distanceKm` haversine, 2 decimals; radius filter (contract) | QA-API-S-08, 12, 13, 21 | ✅ |
| W13 | Net saving = (L − p)·tank − 2·km·1.3·cons/100·p, from config, integer (04 §3, contract) | QA-NS-01…10, QA-API-S-10, 12, 14, 15 | ✅ |
| W14 | Diesel refPrice = latest Oslo level L from the newest **ok** run (not the daily median, not an older run) | QA-API-S-09, E2E-01 | ✅ |
| W15 | refPrice fallback: median of fresh (≤ 6 h) prices in the radius, latest per station | QA-API-S-14, 15, 20 | ✅ (no age limit on L or minimum sample size: QA-SPEC-W3, W4) |
| W16 | refPrice null → every netSavingNok null (contract) | QA-API-S-16, 18, 19 | ✅ |
| W17 | Sort: netSavingNok desc, nulls last, then price asc (contract) | QA-API-S-11, 12, 15, 16, 17, 22, 23 | ✅ round 2: fresh before stale, then the contract order (coordinator decision, IMPL-W12; tie-break on the rounded value, QA-SPEC-W9) |
| W18 | `/api/market` 200, exact contract keys, default days 30 | QA-API-M-01, 02 | ✅ |
| W19 | Series ascending, filtered by days, `wdi_nok_l` and `oslo_diesel_median` only | QA-API-M-02, 03, 04 | ✅ (30 Oslo days including today, QA-SPEC-W8) |
| W20 | days max 365 (366 never served), 1 OK, bad values → 400 | QA-API-M-04, 10…14, 20 | ✅ |
| W21 | `latest` from the newest ok prices run (failed or unfinished runs ignored); null when there are no runs; level null passed through | QA-API-M-21, 22, 23, E2E-01 | ✅ |
| W22 | `/health` still served by the Worker with assets enabled (contract §2) | QA-API-R-01, curl on `wrangler dev` | ✅ |
| W23 | `/api/*` reaches the Worker first (`run_worker_first`); unknown `/api/*` → JSON 404, not the SPA | QA-WEB-CFG-01, 02, QA-API-R-02, curl | ✅ |
| W24 | SPA served at `/` and at deep links | curl `/`, `/some/spa/route` → index.html; QA-WEB-CFG-04 | ✅ |
| W25 | Read-only API (POST rejected), no personal data or config in `/api/*` | QA-API-R-03, R-04 | ✅ (405 on POST; HOME no longer exposed, round 2) |
| W26 | No tax-free (`fd`) prices anywhere (CLAUDE.md 2) | QA-API-S-21, E2E-01, QA-WEB-DIST-03 | ✅ |
| W27 | Attribution text in the built bundle and footer (contract §3) | QA-WEB-DIST-02, UI | ✅ (also credits FRED · Norges Bank, QA-SPEC-W6) |
| W28 | No secrets, chat ids, D1 id or bot token in the bundle; HOME not baked in | QA-WEB-DIST-04, 05 (hard check for HOME in round 2) | ✅ |
| W29 | `web/dist` gitignored | QA-WEB-BUILD-02 | ✅ |
| W30 | `build:web` script; ci.yml builds web; deploy.yml builds web before `wrangler deploy` | QA-WEB-BUILD-01, 03, 04 | ✅ round 2: ci builds **before** `npm test`, so QA-WEB-DIST-* run in CI (QA-WEB-BUILD-06) |
| W31 | Stack: React, Vite, Tailwind v4, MapLibre, OpenFreeMap `liberty` | QA-WEB-BUILD-05, QA-WEB-SRC-01 | ✅ (`dark` style used in dark mode, QA-SPEC-W14) |
| W32 | Same-origin API calls, no hard-coded workers.dev host | QA-WEB-SRC-02, network log | ✅ |
| W33 | docs/06 §2 design tokens, light and dark | QA-WEB-SRC-03 | ✅ (was ❌ QA-BUG-W1, fixed) |
| W34 | Token contrast pairs (text on bg/surface ≥ 4.5:1), computed by QA | QA-WEB-A11Y (20 pairs) | ✅ all pass (lowest: light pricey on bg 4.66:1) |
| W35 | Numbers in Geist Mono with tabular figures | QA-WEB-SRC-04, UI | ✅ |
| W36 | Geolocation only on tap; denied or unanswered → fallback HOME, list still shown | QA-WEB-SRC-05, UI (prompt left unanswered: "Locating…" for 10 s, then "Couldn't get your location. Showing prices near home.", 14 rows kept; granted → `lat/lon` sent, "Near your location") | ✅ |
| W37 | Fuel select changes results | UI: petrol95 → 11 rows, "ref 25.00 · median nearby" | ✅ |
| W38 | Radius chips 5/10/20 change results | UI: 8 / 16 / 23 rows, max distance at 10 km = 9.9 | ✅ |
| W39 | Oslo median card: level now, today's median, WDI line | UI | ✅ (wording confusing, see UX-3 and QA-SPEC-W7) |
| W40 | Map pins = price pills coloured by Δ with ▼/▲; tapping a pin highlights its row and the reverse | UI: pin → 1 row `aria-pressed`; row → pill highlighted | ✅ |
| W41 | Rows show price, name, brand, distance, age, saving and 🧭 Navigate (Google Maps dir) | UI, QA-WEB-SRC-06 | ✅ round 2: age and distance visible on 16/16 rows at 375 px (QA-BUG-W2, W3 fixed) |
| W42 | Empty state "No fresh prices within 10 km. Widen to 20 km?" with a chip | UI (hvo100), QA-WEB-SRC-07 | ✅ (dead end at 20 km, UX-6) |
| W43 | Stale > 6 h greyed | UI | ✅ round 2: greyed by colour, all ≥ 4.5:1 (QA-BUG-W4 fixed) |
| W44 | Error banner from `/health` (`consecutiveFailures ≥ 2` or `lastOk` > 2 h) | UI with 2 injected failed runs: "⚠ Price source is having trouble. Last good update 33 min ago." | ✅ |
| W45 | Loading skeleton; API error state with Retry | UI (delayed and forced-500 `/api/stations`) | ✅ (QA-BUG-W9 fixed in round 2) |
| W46 | No console errors | UI: 0 errors from the app. 3 MapLibre style warnings ("Expected value to be of type number, but found null") from the OpenFreeMap style | ✅ |
| W47 | 375 px and 1440 px, no horizontal scroll | UI: `scrollWidth == clientWidth` at both sizes | ✅ |
| W48 | Light and dark (`prefers-color-scheme`) | UI screenshots | ✅ (QA-BUG-W5 fixed in round 2) |
| W49 | Focus visible | UI: 2 px `--focus` outline on select, buttons, chips, map and rows | ✅ |
| W50 | 44 px targets (06 §2) | UI: select, Near me, chips, rows (64 px), Navigate (48×44) OK. Map pills 64×28, dots 20×20, zoom 29×29 | ❌ QA-BUG-W6 |
| W51 | Colour is never the only signal (06 §2) | UI | ⚠️ arrows everywhere, but the text label is only in `aria-label` (QA-BUG-W8) |
| W52 | Lighthouse mobile ≥ 90 (06 §2) | — | ⛔ no Lighthouse run. The 286 KB-gzip MapLibre chunk is lazy-loaded, but it's a risk |
| W53 | Worker CPU ≤ 10 ms for `/api/*` | — | ⛔ needs `wrangler tail` in production. At most 3 D1 queries per request (IMPL-W5) |

## Bugs

### QA-BUG-W1 (Low, fixed): dark `--ink` token was `#ECEEEE` instead of `#ECEFEE`
- **Repro:** QA-WEB-SRC-03 against `web/src/styles.css`.
- **Expected:** docs/06 §2, dark `--ink` = `#ECEFEE`. **Actual (first build):** `#eceeee`. The implementer fixed it before this report.

### QA-BUG-W2 (High, fixed): the price age was cut off on every row at 375 px
- **Repro:** 375×812, default view. The row's sub-line "Uno-X · 0.4 km · 10 min ago" was truncated with an ellipsis, so the age's left edge (x = 211) sat past the clipping box (right = 200) on **14 of 14 rows**.
- **Expected:** CLAUDE.md rule 2 ("Never show a price without its age") and contract §3 (each row shows age). **Actual:** the age was visible only to screen readers. Fixed before this report: the age now has its own right-hand column, and QA re-measured it as visible on all rows.

### QA-BUG-W3 (Medium, fixed in round 2, IMPL-W13): distance is cut off on some rows at 375 px
- **Repro:** 375×812, diesel, 10 km. In rows with a long brand, the sub-line truncates ("Circle K · 2.0 …", "Uno-X · 0.4 …"). QA measured 3 of 14 rows with the distance clipped. See `docs/screens/qa-375-light-full.png`.
- **Expected:** contract §3, each row shows distance. **Actual:** the distance is clipped. The brand is repeated (it's already in the name "Circle K Kalbakken"), which wastes the space.
- **Suggestion:** drop the brand from the sub-line when the name already starts with it, or move the distance next to the age in the right column.

### QA-BUG-W4 (Medium, fixed in round 2, IMPL-W13): stale rows and stale pills fail WCAG AA contrast
- **Repro:** any row with `stale: true`. The whole row button has `opacity-60`.
- **Measured (effective colour on the row background):**
  - Light mode: sub-line 2.46:1, "stale · 10 h ago" 2.69:1, "Save ~18 kr" 2.43:1, "▼ 0.39" 2.43:1.
  - Dark mode: 3.14–4.32:1.
  - Stale map pills (`opacity: .55`): about 2.4:1 on the light map.
- **Expected:** docs/06 §2 quality bar, WCAG 2.2 AA 1.4.3 (≥ 4.5:1). Stale prices are information, not disabled controls, so no exception applies. **Actual:** 20 text nodes fail in each mode.
- **Suggestion:** grey by colour, not opacity. Use `--ink-muted` (5.87:1) for the price and saving, keep the "stale" label in `--alert`, and add a dashed left border or a "stale" chip.

### QA-BUG-W5 (Medium, fixed in round 2, IMPL-W13): the dark-mode "at reference" (neutral) pill has white text on `#9AA3A5`, 2.57:1
- **Repro:** dark mode, Petrol 95, 10 km. The station whose price equals refPrice (25.00) gets `data-tone="neutral"`, which renders as white on `--neutral #9AA3A5`.
- **Expected:** WCAG AA (≥ 4.5:1; 3:1 is the bare minimum even for large text). **Actual:** 2.57:1. For non-diesel fuels with an odd number of fresh prices this always happens, because the median is one station's own price. The dark override `color:#0e1112` covers only `cheap` and `pricey`.
- **Suggestion:** add `neutral` to the dark override (`#0E1112` on `#9AA3A5` is 7.4:1).

### QA-BUG-W6 (Low, open): map tap targets are below 44 px
- **Repro:** 375×812. Full pills measure 64×28, compact pills ("dots", IMPL-W8) 20×20, MapLibre zoom buttons 29×29.
- **Expected:** docs/06 §2 "44 px targets". The 20 px dots are also below WCAG 2.2 AA 2.5.8 (24 px), because they appear exactly where markers crowd together. **Actual:** listed above.
- **Note:** the list is a full accessible alternative, which reduces the impact. QA-SPEC-W11 asks the spec to decide the rule for the map.

### QA-BUG-W7 (Medium, fixed in round 2, IMPL-W11: default origin is Oslo S): `/api/stations` with no coordinates publishes HOME
- **Repro:** `curl "http://127.0.0.1:8799/api/stations"` → `"origin":{"lat":59.93,"lon":10.8}`. The same holds in QA-API-V-22.
- **Expected:** docs/05 §2, "Read-only, no personal data". **Actual:** anyone can read the owner's home coordinates from a public, unauthenticated endpoint. This was a deliberate implementation choice (IMPL-W2) because the contract is silent (QA-SPEC-W2).
- **Suggestion:** keep the server-side fallback, but return `origin: null` (or rounded) when HOME was used. The page already tracks "Near home" itself.

### QA-BUG-W8 (Low, open): ▼/▲ have no visible text label
- **Repro:** list rows show "▼ 1.19" under the price, and pills show "▼23.40". The words "below/above ref" exist only in `aria-label`.
- **Expected:** docs/06 §2, "Colour is never the only signal: always add ▼/▲ **and a label**." **Actual:** arrow and number only. A sighted user has to infer what 1.19 is relative to.
- **Suggestion:** "1.19 below" in the row (the pill can stay arrow-only).

### QA-BUG-W9 (Low, fixed in round 2, IMPL-W13): the error state also says "0 stations within 10 km"
- **Repro:** force `/api/stations` to 500 (`docs/screens/qa-375-light-api-error.png`). The heading reads "0 stations within 10 km" above "Couldn't load prices (internal error). Retry".
- **Expected:** "Honest about gaps" (docs/06 §1). An error isn't zero stations. **Actual:** the two statements contradict each other.
- **Suggestion:** hide the count, or show "Stations within 10 km", while in the error state.

## UX findings (as a user-tester)

1. *(Addressed in round 2: the first row now ends at 638 px.)* **The answer is below the fold on a phone.** At 375×812 the first station row starts at y = 823 px. Before it come the header, controls, a 190 px market card and a 42 vh map. The question I came with ("where do I fill up?") needs a scroll every time. *Suggestion:* put a "Best now" strip with the top 1–3 rows directly under the controls. Collapse the market card to one line ("Oslo 23.59 · ▲ 0.19 vs today · wholesale ▼"). Shrink the map to about 30 vh on mobile.
2. *(Addressed in round 2: fresh rows are ranked first.)* **Old prices are recommended.** Rows 3 and 4 in the seeded data are 10 h and 21 h old, but rank above 22-minute-old prices with "Save ~18 kr". Greying doesn't stop them looking like advice. *Suggestion:* rank fresh rows first and list stale rows after them under a "Possibly outdated" divider (QA-SPEC-W1).
3. **The median card doesn't tell me whether now is a good time.** "Level now 23.59 · Today's median 23.40 · ▲ 0.19 above today" made me ask: above *what*, and is that bad? "Wholesale cost 7.03 kr/L ▼ 0.13 down since 10-18" is jargon, and "10-18" is an ambiguous date format for a Norwegian user (18.10). *Suggestion:* "Oslo diesel 23.59, 0.31 below the 14-day normal: a good day to fill" (docs/06 §1 wording), and "18 Oct".
4. *(Addressed in round 2: "vs Oslo average".)* **"ref" is jargon.** The header "ref 23.59 · Oslo level" and the row hint "▼ 1.19" need decoding. *Suggestion:* "Compared with Oslo average 23.59", and "1.19 under Oslo avg" in rows. Say once, near the list, that savings include the detour.
5. **The map is crowded and duplicates the list.** Overlapping pills in the centre are hard to tap, and the arrow-only dots carry no price. On desktop the map takes 70 % of the width while the list is squeezed into 400 px and truncates names ("Circle K Kalbak…"). *Suggestion:* on desktop, give the list 480–520 px. On mobile, consider a "Map / List" toggle.
6. **Empty state at 20 km is a dead end.** "No fresh prices within 20 km." has no action, though the API allows 30 km and another fuel might have data. *Suggestion:* offer "Try 30 km" or "Switch to Diesel".
7. **Keyboard users have to tab through every map pill.** There are 22 tab stops (14 pills, zoom, map) before the first list row. *Suggestion:* add a "Skip to list" link, or `tabindex="-1"` on pills (the list mirrors them).
8. **Near me is a one-way door.** After locating, the button stays pressed and there's no way back to Home. When the permission prompt is ignored, "Locating…" spins for 10 s with no cancel. *Suggestion:* make it a toggle (Home ⇄ Near me) and shorten the timeout to about 6 s.
9. **The 🧭 Navigate icon** renders as a small pinkish emoji on Windows and has no visible text. On desktop I didn't recognise it as "directions". *Suggestion:* use a "Go" or "Route" text button, or an SVG icon with a visible label at ≥ 1024 px.
10. **The saving qualifier is easy to miss.** "Savings are for a full tank, if you go there just to fill up" is good, but it's 12 px muted text above the list and scrolls out of view. "~84 kr dearer" on most rows reads as negative and noisy. *Suggestion:* show savings only when positive, and keep the qualifier in the list header.

## Observations (not counted as bugs)
- ~~CI never runs the bundle checks~~: fixed in round 2. ci.yml and deploy.yml now build before `npm test` (QA-WEB-BUILD-06).
- **`wrangler dev` and rebuilds.** Rebuilding while `wrangler dev` runs left QA's dev server answering 404 on `/` until restart. IMPL-W14 traces this to an orphaned `workerd.exe` on Windows. This is dev-only.
- **Diesel refPrice with a stalled job.** QA-API-OBS-01 recorded refPrice 26.00 from a 48-hour-old run, showing "Save ~146 kr" on a 20-hour-old price. The source-down banner is the only cue (IMPL-W4, QA-SPEC-W3).
- **Clock skew** (future `observed_at`) shows as "just now" (QA-API-OBS-03). That's acceptable, and it's consistent with Phase 1 QA-BUG-4.
- **Bundle size.** The initial JS is 75 KB gzip, the fonts are 5 woff2 files (~120 KB), and MapLibre (286 KB gzip) is lazy-loaded. That should be OK for Lighthouse, but it's unmeasured.

## Untestable locally
- Lighthouse mobile ≥ 90 (no Lighthouse run).
- Worker CPU for `/api/*` in production.
- The deployed URL serving assets.
- Real-phone geolocation UX: iOS Safari prompts, and the permission state after a previous denial.
- GitHub CI/deploy runs.
- Live OpenFreeMap tile availability (it worked from QA's machine).
- Screen-reader walkthrough with NVDA or VoiceOver. QA inspected the `aria-label` content only.

## Screenshots (`docs/screens/`)
`qa-375-light-top.png`, `qa-375-light-full.png`, `qa-375-light-focus.png`, `qa-375-light-source-down.png`, `qa-375-light-api-error.png`, `qa-375-dark-top.png`, `qa-375-dark-full.png`, `qa-375-dark-petrol95.png`, `qa-375-dark-empty-20km.png`, `qa-1440-light.png`, `qa-1440-dark.png`, `qa-1440-dark-selected.png`; round 2: `qa-r2-375-light-full.png`, `qa-r2-375-dark-full.png`, `qa-r2-375-dark-api-error.png`.

## Spec flaws
See `docs/spec-flaws-qa.md` § Web v1, QA-SPEC-W1…W14. Several overlap with the implementer's log (IMPL-W2, W4, W5, W6, W9), and QA agrees with the choices made there.
