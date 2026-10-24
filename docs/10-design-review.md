# 10 · Design review log

## v3 (2026-10-24): open endpoints only, no partners

| Decision | Why |
|---|---|
| **Primary station prices = public, keyless `backend.drivstoffapp.no` API** | Found via an open-source Home Assistant integration (oko-fuel). Tested: 95 of 100 Oslo stations had a diesel price < 24 h old, 57 < 6 h |
| Dropped partnership emails, Google Places probe, `/p` crowd reports, photo OCR | User constraint: open endpoints only, no partners, keep it simple. Station data no longer needs crowdsourcing |
| Gates removed: best deal near me + cheap-station alarm are back in the MVP | The data exists |
| Market-drop alarm driven by the **real Oslo median vs its 14-day history** (the original wish). WDI is demoted to a context/early-warning line | Real data beats a proxy. WDI still explains *why* (market vs tax/price war) |
| Station table is upserted from the price API response. No separate import job | One less moving part |
| New risk: drivstoffapp.no has no published terms or SLA | Poll gently, attribute, fixture-tested adapter, failure ping. If it goes away, market context (FRED/Norges Bank) keeps working, and the ODbL Drivstoffpriser data is a fallback |

## v2: original challenges

A senior-engineer review of specs v1 (2026-10-24), and how v2 resolves each challenge. Keep adding to this log when decisions change.

| # | Challenge | Severity | Resolution in v2 | Where |
|---|---|---|---|---|
| 1 | **Data source unresolved, yet five phases were planned on mock data.** "You're designing a house before you know there's water." | 🔴 Critical | Ran the feasibility spike. 13 sources were tested with reproducible scripts. Found an open-data path for market alarms (Wholesale Diesel Index, 0.92 correlation over 10 years). Station-level features are now **explicitly gated** behind an unlock, and nothing is built for them before the gate opens. The mock adapter was dropped | [01](01-data-sources.md), `scripts/` |
| 2 | **Alert maths written twice** (TypeScript and SQL), so the two copies drift apart | 🟠 High | One implementation: `src/core/signals.ts`, pure and tested. The DB only stores | [04](04-alert-engine.md) |
| 3 | **YAGNI: auth, profiles, rules tables and onboarding for one user** | 🟠 High | Removed. Single-user config in env vars, a chat-ID allowlist, and a 6-table schema (was 13) | [03](03-data-model.md) |
| 4 | **Statistics too clever for day one** (42 hour-of-week bands, MAD z-scores) | 🟠 High | Market rule = 5-day change + 30-day median, two lines. Outlier rule = deviation from the local median or the national fallback. The advanced versions are parked until ≥ 4 weeks of dense data justify them | [04 §1–2](04-alert-engine.md) |
| 5 | **Thresholds are guesses** | 🟠 High | Two-step calibration: (a) a historical replay of the rule over 2015→today (Phase 1 deliverable), (b) 14 days of **shadow mode** with a daily "would have sent" digest and 👍/👎 | [04 §1, §4](04-alert-engine.md) |
| 6 | **Next.js for what is a static page with client-side data** | 🟡 Medium | The MVP UI is the **Telegram bot**. The Phase 4 dashboard is Vite + React on Cloudflare Pages | [06](06-ux-ui-spec.md), [07](07-tech-stack.md) |
| 7 | **Fragile scheduling chain** (pg_cron → pg_net → Edge Function, plus Supabase pausing after 7 idle days) | 🟡 Medium | **One Cloudflare Worker** with native cron triggers and the webhook in the same place. Every run is logged, two failures send a Telegram ⚠️, and a weekly external `/health` check covers the case where the Worker itself dies | [02](02-architecture.md), [09](09-ops-security-cost.md) |
| 8a | Optimistic estimates ("1 evening") | 🟢 Low | Re-estimated per phase, debugging included | [08](08-build-plan.md) |
| 8b | Detour-cost model overstates the cost when a station is on your route | 🟢 Low | Kept as a conservative upper bound and labelled in the UI ("if you go there just to fill up") | [04 §3](04-alert-engine.md) |
| 8c | Playwright end-to-end tests in the MVP | 🟢 Low | Dropped. Vitest on `src/core` plus adapter fixture tests | [07](07-tech-stack.md) |

## New risks found during v2 (watch list)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tax or fee changes break the market signal (as in Sep 2026: pump +6.04 vs WDI +1.12) | Medium | Tax detector using the national average. The wording says "market cost signal", not a price promise |
| FRED or OpenVan change format or disappear | Low–medium | Adapter fixtures plus the failure ping. ULSD alternatives: EIA API (free key) |
| Worker free tier allows only 10 ms CPU per invocation | Low | Heavy parsing moved to GitHub Actions. The $5 plan is the fallback |
| Station-level data never unlocks | Medium | The product still delivers M1–M5 ("when to fill up"). `/p` builds my own history, and friends can join as reporters |
| ULSD is a US benchmark; European diesel (ICE gasoil) is the true input for Norway | Medium | Good enough for direction (79 % hit rate). Swap in a European gasoil series if a free daily source is found |
