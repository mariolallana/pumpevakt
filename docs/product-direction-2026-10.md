# Product direction, October 2026 (proposal for spec v4)

This proposal does not edit docs/00–10, which stay read-only until the owner adopts a v4. It records what user testing and research showed, and what the owner decided on 2026-10-24.

## What we learned

1. **No trustworthy per-station source exists in Norway.**
   - Every station price (DrivstoffAppen, drivstoffapp.no, drivstoffprisene.no) is the last thing a driver typed in.
   - Unlike Denmark, chains are not required to publish pump prices.
   - Official data is only market-wide: the wholesale price (FRED × Norges Bank), chains' indicative list prices, and SSB's monthly averages.
2. **drivstoffapp.no can lag hours behind DrivstoffAppen.** Example: Circle K Kiellands Plass diesel showed 25.10 from 12:38, while DrivstoffAppen showed 29.18 from about 13:30.
3. **Coverage is fine.** 117 of 120 public diesel/petrol stations in our circles have prices (98 %), see `docs/osm-coverage.md`.
4. **Timing beats location.**
   - Oslo diesel rose about 3 kr in one step on 2026-10-24 (median 24.25 → 27.32 around 13:30–15:00).
   - That is about 150 kr on a 50 L tank, more than the usual spread between good stations nearby.
5. **Market-wide signals are robust; per-chain intraday signals are not (yet).**
   - About 160 diesel reports a day across Oslo.
   - Per chain per hour, that's only 1–13 reports, too few to time a chain's rise.
   - A per-chain *morning* level (06–12) gets 7–11 stations per big chain, which is enough.

## Owner decisions (2026-10-24)

| # | Decision |
|---|---|
| 1 | **"When" before "where."** The headline answers *fill up now or wait?* from market-wide signals. The station list stays underneath, labelled as driver reports. |
| 2 | **Web app first.** Alarms will come as phone notifications from the web app. Telegram (Phase 2/3 in the v3 spec) is deferred. |
| 3 | **Trust bar for station alarms.** A station-based alarm ("X is much cheaper") ships only if fewer than 30 % of the owner's field checks (👍/👎) are off by more than 1 kr. |

## What exists now

- **Rise detection** (`src/core/rise.ts`):
  - Runs Oslo-wide on each prices run's snapshot. A step is at least 1 kr between the 4 h before and the 3 h after, with at least 8 reports on each side, within the last 24 h.
  - The result is stored in `runs.detail.rises` for diesel and 95.
- **Outdated prices:** a price reported before the latest rise and at least 1 kr below the market since then is flagged `outdated`. It is never hidden.
- **Chain morning levels** (`src/core/chains.ts`):
  - Circle K, Uno-X, Esso, St1 and others: the median of each station's latest 06–12 report, needing at least 5 stations.
  - The market job stores the last 7 full days in `market_daily` (series `am_<group>_<fuel>`). Today's level is computed live.
- **`GET /api/outlook?fuel=diesel|petrol95`** returns:
  - the verdict: `wait` (risen and still up), `good` (eased back), `normal` (no rise in 24 h) or `unknown`
  - the rise and the Oslo level now
  - the morning level vs a 14-day normal (from 5 days of history)
  - 30 days of chain history
- **Web:** a "Fill up now?" card at the top. It shows facts and advice separately, a chain price row and a trend chart.

## Next (in order)

1. **Weeks 1–2:** collect history. The owner does about 20 field checks with 👍/👎.
2. **Week 2:**
   - Web push notifications in **shadow mode**: alarms are logged, not sent.
   - Market-drop alarm: the morning level falls at least 1 kr below its 14-day normal, or wholesale is falling.
   - Station alarm: a price reported after the latest market-wide rise, and confirmed by a second report or a neighbour.
3. **Weeks 3–4:**
   - Review the shadow alarms and field-check accuracy against the trust bar. Turn on the alarms that proved right.
   - Learn the real daily and weekly cycle from our own data, then replace the generic "usually drifts down" advice with measured hours and days.

## Open issues

- **The centre collection circle hits the source's 100-station cap.** Overlap with the other circles hides this today (98 % coverage), but it should be re-checked with `node scripts/osm-coverage.mjs` if coverage drops.
- **Truck-only stations** (Uno-X Truck and others) are priced in the source and appear in the list. They should probably be filtered out for car drivers.
- **The rise time is only accurate to about ±1 h**, and detection lags the start of a rise by 1–2 h while post-rise reports come in.
