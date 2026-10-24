# 04 · Alert engine

The engine has two goals: **catch real opportunities** and **never spam**. Every rule below is deterministic and testable. The pure maths lives in `packages/core/alerts.ts` and is mirrored in SQL (`evaluate_alerts()`). Unit tests run against fixture time-series.

## 0. Shared definitions

| Term | Definition |
|---|---|
| **Area** | `oslo` = active stations within 25 km of Oslo S (59.9111, 10.7528). Per-user rules can use their own place and radius |
| **Fresh price** | `price_current.observed_at` ≤ 6 h old (≤ 3 h for outlier checks) and `confidence ≥ 0.8` |
| **Bucket** | 15-minute window, Europe/Oslo time |
| **Area level `L`** | Median of fresh prices in the area for a fuel, at the latest bucket (`area_stats_15m.median`) |
| **Hour-of-week band** | 42 bands = 7 days × six 4-hour slots. Used to compare like with like, because prices follow an intraday and weekly cycle ([01 §5](01-data-sources.md#5-known-domain-facts-to-design-for)) |
| **Baseline `B`** | `area_baseline.median_14d` for the current band = median of `L` over the same band in the last 14 days |
| **MAD** | Median absolute deviation. Robust spread: `σ̂ = 1.4826 × MAD` |

**Coverage guard:** never evaluate when `n_fresh < max(10, 0.3 × stations_in_area)`. Low data produces bad alerts.

## 1. Market-drop alarm ("Oslo prices are unusually low")

**Question it answers:** is the general price level now meaningfully below what is normal for this time of the week?

```
drop_abs = B − L
drop_pct = drop_abs / B
trigger  if drop_abs ≥ T_abs AND drop_pct ≥ T_pct
         AND the condition held in the previous bucket too (≥ 30 min persistence)
```

| Sensitivity | `T_abs` (NOK/L) | `T_pct` |
|---|---|---|
| relaxed | 1.50 | 6 % |
| **normal** (default) | **1.00** | **4 %** |
| eager | 0.60 | 2.5 % |

**Enrichment** (added to the message, does not affect triggering):
- `is_30d_low`: `L` ≤ min of daily medians in the last 30 days → "🔻 lowest in 30 days".
- `cheapest_near_home`: the top 3 stations by net saving near Home ([§4](#4-net-saving-ranking)).
- `typical_rebound`: the next band where prices usually rise, from the baseline ("prices usually rise around Thu 12:00").

**Structural-change guard:** if ≥ 80 % of stations moved by the same amount (±0.05) within a single bucket, or the date is 1 January, tag the alert `possible_tax_change`. Send it once as information ("prices dropped across the board, likely a tax/fee change"). After 7 days, reset the baseline to the new level so it doesn't fire every day.

**Cold start:** fewer than 14 days of history → use the median of all available days (needs ≥ 3 days). Fewer than 3 days → disabled, and the UI shows "learning prices: 2 of 3 days".

**De-duplication:** `dedupe_key = market_drop:{rule}:{fuel}:{oslo_date}`. At most one per day. A second alert on the same day is allowed only if `L` drops another ≥ `T_abs/2` ("even lower now"), using key suffix `:2`.

## 2. Outlier-station alarm ("one station is much cheaper than the rest")

**Question it answers:** is a specific station priced far below its neighbours right now?

For each station *s* with a fresh price (≤ 3 h) inside the rule's radius (default: 15 km from Home):

```
neighbours = other stations within 5 km of s with fresh prices      (need ≥ 5; else widen to 10 km)
M_local    = median(neighbours.price)
σ̂_local    = 1.4826 × MAD(neighbours.price)    (floor at 0.15 NOK so tight markets don't explode z)
dev        = M_local − s.price
z          = −dev / σ̂_local
trigger if dev ≥ max(D_abs, D_pct × M_local) AND z ≤ Z
```

| Sensitivity | `D_abs` | `D_pct` | `Z` |
|---|---|---|---|
| relaxed | 2.00 | 8 % | −3.5 |
| **normal** | **1.50** | **6 %** | **−3.0** |
| eager | 1.00 | 4 % | −2.5 |

**Plausibility guards:**
- Reject if `price < 0.6 × SSB latest national monthly average` (typo or bad data). Log it as a data-quality issue.
- Crowd-sourced prices need `confidence ≥ 0.8`, i.e. one confirmation or a clear photo extraction.
- Exclude brands or stations on the user's ignore list (e.g. membership-only prices).

**De-duplication:** `outlier:{rule}:{station}:{fuel}:{oslo_date}`. Re-alert the same day only if the price drops another ≥ 0.50.

**Revalidation at send time:** `notify` re-reads `price_current`. If the price has moved back within threshold, the event is marked `failed` with reason `expired` and is not sent.

## 3. Target-price alarm (v1)

`trigger if min(fresh price within radius of place) ≤ params.target_nok`. Dedupe once per station per day.

## 4. Net-saving ranking

Used by the list sort, the alerts and `stations_near()`:

```
detour_km   = 2 × straight_line_km × 1.3                 (round trip, road factor)
detour_cost = detour_km × consumption_l100 / 100 × price
net_saving  = (ref_price − price) × tank_l − detour_cost   (NOK)
```

`ref_price` = median of fresh prices in the search radius ("what you'd pay at a typical station"). The defaults come from the profile (tank 50 L, 6.5 L/100 km). Display it as "**Save ~62 kr** on a full tank". Negative values read "costs ~10 kr more than average".

> Later (v1+): replace straight-line × 1.3 with real routing (OSRM public demo or OpenRouteService free tier) for the top 5 only.

## 5. Delivery rules (`notify`)

- **Quiet hours** (default 22:00–07:00): the event becomes `deferred` and is sent at `quiet_to` *after revalidation*. Outlier events that expire overnight are dropped.
- **Digest:** if a user has more than 2 events ready in the same run, send one combined message.
- **Global cap:** at most 4 alerts per user per day. Anything beyond goes to the in-app Alerts page only.
- **Retries:** exponential backoff of 1, 5 and 15 min, then `failed`. The watchdog reports failed counts.
- **Feedback:** every message carries 👍/👎. Five 👎 on a rule within 14 days → suggest switching it to "relaxed" (never change it silently).

## 6. Message templates

**Telegram, market drop**
```
⛽ Diesel is cheap around Oslo right now
Oslo median 21.34 kr/L, normally 22.61 for Thursday afternoon (−1.27 kr, −5.6 %)
🔻 Lowest in 30 days

Best near Home:
1. Uno-X Ryen · 20.89 · 1.8 km · save ~78 kr
2. YX Bryn · 20.99 · 2.6 km · save ~70 kr
3. Circle K Helsfyr · 21.09 · 3.1 km · save ~62 kr
Prices usually go up again around Fri 12:00.

[🧭 Navigate to #1]  [📍 Open map]  [👍] [👎]  [🔕 Mute 24h]
```

**Telegram, outlier**
```
💥 Uno-X Ryen: diesel 19.49 kr/L
That's 2.10 kr below nearby stations (median 21.59), price seen 14 min ago.
4.2 km from Home · save ~96 kr on a full tank

[🧭 Navigate]  [👍] [👎]  [🔕 Mute station]
```

**Email:** the same content in a single-column HTML template (React Email). Subject lines: `⛽ Diesel −5.6% around Oslo: 21.34 kr/L` and `💥 Uno-X Ryen diesel 19.49 (−2.10 vs nearby)`.

## 7. Test fixtures (must exist before shipping the alerts)

1. Flat market with noise ±0.2 → **no alerts** over 30 simulated days.
2. Normal intraday cycle (+1.5 jump at 12:00, then drift down) → **no market alerts**. This proves the hour-of-week baseline works.
3. Area-wide −1.3 drop on a Tuesday evening that persists 2 h → **exactly 1** market alert.
4. Single station −2.0 for 3 h → **exactly 1** outlier alert. Reverts before quiet hours end → the deferred alert is **not sent**.
5. Tax change: all stations −0.80 at 00:00 on 1 January → 1 informational alert, baseline reset after 7 days.
6. Coverage drops to 5 fresh stations → **no evaluation** and a watchdog warning.
7. Typo price 2.19 → rejected by the plausibility guard.
