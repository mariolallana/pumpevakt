# 04 · Alert engine (lean v3)

All rules live in **one place**, `src/core/signals.ts`: pure functions tested with Vitest. Nothing is duplicated in SQL.

Shared definitions:
- **Area:** stations within 25 km of Oslo S (59.9111, 10.7528).
- **Fresh price:** observed ≤ 6 h ago.
- **Oslo level `L`:** median of fresh diesel prices in the area at the latest run. Evaluate only if `n_fresh ≥ 30`, otherwise skip (coverage guard).
- **Daily level:** median of all `L` values that day, stored as `market_daily` series `oslo_diesel_median`.

## 1. Market-drop alarm (M2)

```
B = median(daily level over the previous 14 days)
alert if  B − L ≥ T_abs  and  (B − L) / B ≥ T_pct
          and the same condition held in the previous run (≥ 30 min persistence)
```

| Sensitivity | `T_abs` | `T_pct` |
|---|---|---|
| relaxed | 1.50 | 6 % |
| **normal** | **1.00** | **4 %** |
| eager | 0.60 | 2.5 % |

- **Cold start:** with fewer than 7 days of collected history, the alarm is off and `/status` shows "learning: 3/7 days". (Optional: seed history from WDI-adjusted SSB, but that's not needed. KISS.)
- **WDI context line** (information only): "Wholesale cost −0.71 in 5 days, so the drop may continue" or "Wholesale cost flat, so this may be a price war or a tax change".
- **Intraday caveat:** Norwegian prices often jump around midday and drift down. Comparing against the 14-day median of *daily* medians smooths this out. If shadow mode shows evening-only false alerts, compare against the same hour band instead (an advanced option, parked).
- **Dedupe:** `market_drop:{oslo_date}`. A second one the same day only if `L` falls another `T_abs/2`.

## 2. Cheap-station alarm (M3)

For each station with a fresh price in the area:

```
neighbours = other fresh stations within 5 km (need ≥ 5, otherwise widen to 10 km)
M          = median(neighbours)
alert if  M − price ≥ max(D_abs, D_pct × M)
```

| Sensitivity | `D_abs` | `D_pct` |
|---|---|---|
| relaxed | 2.00 | 8 % |
| **normal** | **1.50** | **6 %** |
| eager | 1.00 | 4 % |

- **Distance filter:** only stations within `OUTLIER_RADIUS_KM` (default 15) of Home.
- **Plausibility:** ignore `price < 0.6 × L` (a typo) and `fd_price` (tax-free diesel).
- **Dedupe:** `outlier:{station}:{oslo_date}`. Re-alert the same day only if the price drops another ≥ 0.50.
- **Revalidate before sending** (e.g. after quiet hours). If the price has gone back up, drop the alert.

## 3. Net saving (used by `/near` and alerts)

```
detour_km  = 2 × straight_line_km × 1.3
net_saving = (L − price) × TANK_L − detour_km × CONSUMPTION_L100 / 100 × price
```
Labelled "save ~62 kr *if you go there just to fill up*".

## 4. Shadow mode, feedback, delivery
- The first 14 days run in **shadow mode**: alerts are logged, not pushed. A daily 18:00 digest shows "would have sent …" with 👍/👎. `/shadow off` goes live.
- Quiet hours 22–07 (Oslo): hold alerts, revalidate, then send. At most 3 pushes a day. `/mute 24h`.
- Three 👎 in 30 days → the bot suggests a lower sensitivity. It never changes it silently.

## 5. Templates

```
📉 Diesel is cheap around Oslo right now
Oslo median 23.21 kr/L, 14-day normal 24.40 (−1.19, −4.9 %)
Wholesale cost also −0.52 in 5 days, so it may fall a bit more.
Best near Home:
1. Uno-X Linderud Nord  22.87 · 2.1 km · 40 min ago · save ~68 kr
2. Esso Alna            23.02 · 3.0 km · 1 h ago · save ~58 kr
[⛽ Near me] [👍] [👎] [🔕 24h]
```
```
💥 Uno-X Nedre Bekkelaget: diesel 22.85
1.62 below nearby stations (median 24.47) · 3 h ago · 4.2 km from Home
Save ~78 kr if you go there just to fill up
[🧭 Navigate] [👍] [👎]
```
Footer on every message: "Prices: drivstoffapp.no · Market: FRED, Norges Bank".

## 6. Test fixtures (required before `/shadow off`)
1. Flat Oslo prices ±0.2 noise for 30 days → 0 alerts.
2. Daily midday +1.5 jump then drift down → 0 market alerts.
3. Area-wide −1.2 drop lasting 2 runs → exactly 1 market alert. A drop lasting only 1 run → 0.
4. One station −1.8 vs 8 neighbours → 1 outlier alert. Only 3 neighbours within 10 km → no alert.
5. Price 2.19 → rejected. `fd_price` is never used.
6. `n_fresh = 20` → no evaluation.
7. An alert at 23:00 whose price is back up by 07:00 → not sent.
