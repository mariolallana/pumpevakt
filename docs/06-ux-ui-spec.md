# 06 · UX / UI spec

## 1. Design direction: "Nordic instrument panel"

Calm, precise, glanceable, like a good car dashboard at night. Numbers are the hero and everything else steps back. One accent colour carries meaning (cheap). No gradients, no glassmorphism, no stock icons in circles.

- **The answer before the interface.** The first screen answers "where should I fill up?" in under 2 seconds, without a tap.
- **Every price shows its age.** A price without a timestamp is a lie.
- **Money, not percentages.** "Save ~62 kr" beats "−3.1 %". Percentages are secondary.
- **Map and list are one thing.** Tapping a pin highlights the row and tapping a row flies to the pin.

## 2. Design tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F7F5` | `#0E1112` | App background (slightly warm/cool off-tones, not pure) |
| `--surface` | `#FFFFFF` | `#171B1D` | Cards, sheet |
| `--ink` | `#121516` | `#ECEFEE` | Primary text, prices |
| `--ink-muted` | `#5E6668` | `#9AA3A5` | Meta (age, distance) |
| `--line` | `#E3E6E4` | `#262C2F` | Dividers |
| `--cheap` | `#0F7B5F` | `#3DD6A3` | Below-median prices, savings, CTA |
| `--pricey` | `#B4531A` | `#F29A5C` | Above-median prices |
| `--alert` | `#C62D3A` | `#FF6B76` | Errors, stale-data warnings only |
| `--focus` | `#2457D6` | `#7FA2FF` | Focus rings |

- **Type:** *Geist Sans* for UI and *Geist Mono* (tabular figures) for every price and number, so digits never jump when updating. Scale: 12 / 14 / 16 / 20 / 28 / 44 (hero price).
- **Radius:** 10 px on cards, 999 px on chips and price-pins. **Spacing:** 4-pt grid. **Elevation:** a single shadow level, used only for the bottom sheet.
- **Colour is never the only signal.** Cheap/pricey also carry ▼/▲ glyphs and a text label.
- **Motion:** 150–200 ms ease-out. Price changes cross-fade the digits. Respect `prefers-reduced-motion`.

## 3. Information architecture

```
Bottom nav (mobile) / left rail (desktop)
├─ Find      (home: map + list)
├─ Trends    (Oslo market)
├─ Alerts    (history + rules)
└─ Settings
Station detail = sheet/route from Find
```

## 4. Screens

### 4.1 Find (home)
```
┌──────────────────────────────────────┐
│ ◉ Diesel ▾    📍 Near me ▾    5 km ▾ │  ← sticky filter bar (chips)
│ ┌──────────────────────────────────┐ │
│ │ Oslo diesel  ▼ Cheap now  −4.2 % │ │  ← market status chip (tap → Trends)
│ └──────────────────────────────────┘ │
│            [ MAP · price pins ]      │  pins = pills "20.89" coloured by Δ vs ref
│     (20.89) (21.34)  (22.10)         │  selected pin enlarges + ring
│ ───────────── drag handle ─────────  │
│ BEST DEAL                            │
│ 20.89  Uno-X Ryen        Save ~78 kr │  hero row: 44 px mono price
│        1.8 km · 12 min ago   [Go →]  │
│ ──────────────────────────────────── │
│ 20.99  YX Bryn           Save ~70 kr │
│ 21.09  Circle K Helsfyr  Save ~62 kr │
│ 22.10  Esso Økern     ▲ +12 kr more  │
│  Sort: Saving · Price · Distance     │
└──────────────────────────────────────┘
```
- Bottom sheet (vaul) with 3 snap points: peek (best deal only), half, full list. On desktop: list on the left (400 px), map on the right.
- **Location permission:** ask only after a "Use my location" tap, never on load. The fallback is the saved Home, else Oslo S.
- **States:**
  - *Loading:* skeleton rows plus pins fading in.
  - *Empty radius:* "No fresh prices within 5 km. Widen to 10 km?" (one-tap chip).
  - *Stale:* the row is muted with "3 h old" in `--alert`. Stale rows are never chosen as the hero.
  - *Offline:* last data with a banner "Offline · showing prices from 14:20".
  - *Source down:* a top banner from `market_status.updated_at > 2 h`.

### 4.2 Station detail
- Header: brand logo (monogram fallback), name, address, distance, **[Navigate]** (deep link: `https://www.google.com/maps/dir/?api=1&destination=lat,lon`, or Apple Maps on iOS).
- Price per fuel type, each with age and Δ vs area ("0.45 below nearby").
- A 7/30-day **step chart** of this station against a faint area-median line.
- "This station is usually cheapest on: Mon evening" (from history, once ≥ 4 weeks of data exist).
- v1: **Report a price** button and ⭐ favourite.

### 4.3 Trends
- Big number: today's Oslo median, Δ vs 14-day baseline, and a label (Cheap / Normal / Expensive).
- 90-day line chart: daily median plus a min band. National SSB monthly as a dotted step line ("Norway monthly avg, SSB").
- **"Best time to fill" heatmap:** 7 days × 6 bands, cheapest cells highlighted, with a one-line insight on top: "Usually cheapest: Sun 20–24 & Mon 16–20".
- Learning state if there are fewer than 14 days of data: progress bar "Learning Oslo's price rhythm: 9/14 days".

### 4.4 Alerts
- **Feed:** cards for past alerts (what, when, price then vs now, 👍/👎).
- **Rules:** three toggle cards (Market drop · Cheap station · Target price) with a plain-language sensitivity slider: *Only big drops* — *Balanced* — *Tell me more*. The slider shows a live preview: "With this setting you'd have got **3 alerts** in the last 30 days" (computed by replaying history, v1).
- **Channels:** Telegram (Connect → deep link), Email (verified via magic link), Push (v1). There's a **Send test** button for each.
- Quiet hours picker.

### 4.5 Settings
Fuel type, tank size, consumption (with a "Typical diesel car: 6.5" hint), default radius, saved places (map picker), language (v1), data sources and attribution, export my data, delete account.

### 4.6 Onboarding (first run, 3 steps, skippable)
1. "What do you drive?" → fuel plus tank size (3 presets: Small 40 L · Medium 55 L · Large 70 L).
2. "Where's home?" → map pin or address search (Photon/Nominatim). Used only for alerts.
3. "How should we tell you?" → Connect Telegram (recommended) or email. Done → Find.

## 5. PWA
- `manifest.webmanifest`: name "Pumpevakt", standalone, theme `#0E1112`, maskable icon (a pump nozzle forming a ▼).
- Service worker (Serwist): app shell cache-first, `stations_near` responses stale-while-revalidate (10 min), offline page.
- iOS: an "Add to Home Screen" hint sheet shown once, because Web Push on iOS only works once the app is installed.

## 6. Accessibility & quality bar
- WCAG 2.2 AA contrast in both themes. Every interactive target ≥ 44 px. Full keyboard navigation, including the map list.
- Map pins are mirrored by the accessible list, so the map itself is `aria-hidden` with a "Skip to list" link.
- Numbers formatted with `Intl.NumberFormat('nb-NO')` (decimal comma available via the locale toggle, default `en-NO` with a dot for now).
- Lighthouse mobile ≥ 90 on all four categories. CLS < 0.05 (reserve space for prices).

## 7. Vibe-design workflow
1. Generate first drafts of Find and Trends in **v0.dev** with this doc pasted as context, then port them into the repo as shadcn components.
2. Lock the tokens in `globals.css` (`@theme` in Tailwind v4) **before** building screens.
3. Review each screen at 375 px and 1440 px, in light and dark, before merging.
