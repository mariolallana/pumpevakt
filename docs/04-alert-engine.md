# 04 · Alert engine (lean v2)

All rules live in **one place**: `src/core/signals.ts`, pure functions tested with Vitest. Nothing is duplicated in SQL ([10](10-design-review.md) challenge 2).

## 1. Market alarm (MVP, open data)

Inputs: the daily `wdi` series (NOK/L, [01 §2](01-data-sources.md#2-the-creative-unlock-the-wholesale-diesel-index-wdi)) and the weekly national pump average `national_diesel_nok_l`.

```
today  = latest WDI value
d5     = today − WDI 5 business days earlier
ref30  = median(WDI over last 30 calendar days)

market_drop  if d5 ≤ −T  and today ≤ ref30 − T/2
market_rise  if d5 ≥ +T  and today ≥ ref30 + T/2
```

| Sensitivity | `T` (NOK/L of wholesale cost) | Rough pump equivalent (pass-through ≈ 1.1: 1.25 in theory with VAT, ~1.07 measured on monthly data) |
|---|---|---|
| relaxed | 0.90 | ~1.00 kr/L |
| **normal** | **0.60** | **~0.65 kr/L** |
| eager | 0.40 | ~0.45 kr/L |

Both conditions are deliberately simple: a sharp recent move **and** a level that differs from the month. That filters out a bounce back after a spike. These thresholds are starting points. They get calibrated by:
1. **Historical replay** (Phase 1 task): run the rule over 2015→today daily data. Target 4–10 alerts per year at `normal`. Check how often the national pump average moved the same way within 14 days. Record the hit rate here.
2. **Shadow mode** (§4): 14 days live without sending.

**Confirmation line** (information only, never a gate): when the latest weekly national pump average moved the same way, add "✅ Pump prices already following (national avg −0.42 this week)".

**Tax/fee detector:** if the national average moved > 1.00 kr/L in a week while |WDI change| < 0.30, send one `system` info message: "Pump prices jumped without a market move. Likely a tax or margin change." It is not a buy signal.

**De-duplication:** `dedupe_key = market_{drop|rise}:{ISO week}`. A second alert in the same week happens only if the move extends by another `T` (key suffix `:2`). A change of direction is always allowed.

## 2. Cheap-station (outlier) alarm: gated until station data exists

Runs after each station-price job, for each price observed in the last 3 h within 15 km of Home:

```
ref  = median(prices ≤ 24 h old within 10 km)   if at least 5 of them,
       otherwise the latest national average (OpenVan)
dev  = ref − price
alert if dev ≥ max(1.50, 6 % × ref)
```

- Plausibility: reject `price < 0.6 × national average` (a typo).
- Dedupe: `outlier:{station}:{fuel}:{oslo_date}`. Re-alert the same day only if the price drops another ≥ 0.50.
- The more advanced version (robust z-score against neighbours, hour-of-week baseline) from v1 of these specs is **parked** until we have ≥ 4 weeks of dense station data to justify it.

## 3. Net saving (used by `/near`)

```
detour_km   = 2 × straight_line_km × 1.3
net_saving  = (ref − price) × TANK_L − detour_km × CONSUMPTION_L100 / 100 × price
```
Shown as "save ~62 kr *if you go there just to fill up*". It's an upper bound on the detour cost, labelled honestly.

## 4. Shadow mode & feedback

- `settings.shadow = on` for the first 14 days. Alerts are stored with `shadow=1` and not pushed. A daily 18:00 digest lists "would have sent: …" with 👍/👎 buttons.
- `/shadow off` goes live. Every real alert carries 👍/👎. Three 👎 within 30 days → the bot suggests a lower sensitivity (it never changes it silently).

## 5. Delivery rules

- Quiet hours (`QUIET_HOURS`, default 22–07 Oslo): hold messages until the end of quiet hours. Market alerts still matter in the morning, but outlier alerts are re-checked first and dropped if the price has moved.
- `/mute 24h` sets `settings.muted_until`.
- At most 3 pushes per day. Extra alerts go into the next `/status`.

## 6. Message templates

**Market drop**
```
📉 Diesel market falling: wait if you can
Wholesale cost 10.42 kr/L, −0.71 in 5 days (30-day median 11.20)
Pump prices typically follow within days (backtest: same direction 79 % of big moves).
✅ National pump avg already −0.38 this week (27.22 → 26.84)
Brent $108 · USD/NOK 9.35
[📊 Status]  [👍] [👎]  [🔕 Mute 24h]
```

**Market rise**
```
📈 Diesel market rising: fill up soon
Wholesale cost 11.90 kr/L, +0.82 in 5 days. Pumps usually follow within days.
[⛽ Near me]  [👍] [👎]
```

**Outlier (gated)**
```
💥 Uno-X Ryen: diesel 19.49
2.10 below nearby (median 21.59) · seen 14 min ago · 4.2 km from Home
Save ~96 kr if you go there just to fill up
[🧭 Navigate]  [👍] [👎]
```

Every message footer: "Data: FRED, Norges Bank, OpenVan · stations © Drivstoffpriser/OSM (ODbL)".

## 7. Test fixtures (`test/fixtures/`, required before shadow mode ends)

1. Flat WDI ±0.1 noise for 90 days → 0 alerts.
2. WDI −0.8 over 5 days from a flat level → exactly 1 `market_drop`. It stays low for 3 weeks → no repeat (weekly dedupe only re-fires if it extends by `T`).
3. A spike +1.0 then back down to the old level → 1 `market_rise` and **no** `market_drop` (because of the `ref30` condition).
4. National +1.2 in a week with flat WDI → 1 `system` tax-change info.
5. Outlier: 6 nearby reports at 21.5 and one at 19.8 → 1 alert. With only 2 nearby reports, the national fallback is used.
6. Typo price 2.19 → rejected.
7. Quiet hours: an alert at 23:00 is delivered at 07:00. A muted bot sends nothing.
