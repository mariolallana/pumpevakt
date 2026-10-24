# 06 · UX / UI spec

The product has two surfaces, delivered in this order:
1. **Telegram bot (MVP).** This is where 95 % of the value lands: pushes plus a few commands.
2. **Web dashboard (Phase 4).** A read-only page for the map and trends, built only once station prices exist (gate G3).

## 1. Telegram UX principles

- **The answer first, in one line.** The first line of every message is the decision ("wait if you can", "fill up soon"), then the numbers.
- **Money, not maths.** Show kr/L and "save ~62 kr". Use the WDI jargon only in `/status`.
- **Every number has a date or age.** "seen 14 min ago", "data as of Mon 20 Oct".
- **Buttons over typing.** Inline keyboards for feedback, mute, navigate and station confirmation.
- **Honest about gaps.** "No fresh prices near you. Report one with /p", never a silent empty list.
- **Quiet by default.** At most 3 pushes a day, quiet hours, and shadow mode on first run.
- Formatting: Telegram HTML mode. Numbers use a dot decimal and two decimals. Emoji are used only as glanceable icons (📉 📈 💥 ⚠️ ✅), one per line maximum.

### `/status` layout
```
⛽ Diesel market · Fri 24 Oct
Wholesale cost  10.42 kr/L   ▇▇▆▅▅▄▃▃▂▂  (30 days)
5 days  −0.71   ·   30 days  −1.05
National pump avg  26.84 (week 43, −0.38)
Signal: 📉 falling since Wed. Wait if you can.
Data as of Mon 20 Oct (FRED) · Thu 23 Oct (Norges Bank)
```

### `/near` layout
```
📍 Near you (10 km) · diesel
1. Uno-X Ryen        20.89 · 1.8 km · 2 h ago · save ~78 kr
2. Circle K Helsfyr  21.09 · 3.1 km · 5 h ago · save ~62 kr
Other stations nearby have no fresh price. Send one with /p
```

## 2. Web dashboard (Phase 4)

**Stack:** Vite + React + TypeScript, Tailwind v4, shadcn/ui, MapLibre GL + OpenFreeMap tiles, Recharts. It's a static site on Cloudflare Pages that reads `GET /api/*` from the Worker. No login, because the data is read-only.

**Design direction: "Nordic instrument panel".** Calm, glanceable, numbers first.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F7F5` | `#0E1112` | Background |
| `--surface` | `#FFFFFF` | `#171B1D` | Cards |
| `--ink` / `--ink-muted` | `#121516` / `#5E6668` | `#ECEFEE` / `#9AA3A5` | Text |
| `--cheap` | `#0F7B5F` | `#3DD6A3` | Below reference, falling market |
| `--pricey` | `#B4531A` | `#F29A5C` | Above reference, rising market |
| `--alert` | `#C62D3A` | `#FF6B76` | Stale or error only |

- Type: Geist Sans for UI, **Geist Mono (tabular figures)** for every number.
- Colour is never the only signal: always add ▼/▲ and a label.
- Two views only:
  1. **Market:** a big signal card (same wording as the bot), a 90-day WDI vs national pump average chart, the SSB monthly as a dotted step line.
  2. **Map:** station pins as price pills coloured by Δ vs reference, a list beneath sorted by net saving, and price age on every row. Stale prices (> 24 h) are greyed and never ranked.
- States: loading skeleton, "no fresh prices" (with the /p hint), and data-source-down banner (from `/health`).
- Quality bar: WCAG 2.2 AA, 44 px targets, Lighthouse mobile ≥ 90, checked at 375 px and 1440 px in light and dark.
- Attribution in the footer: © OpenStreetMap contributors · Drivstoffpriser (ODbL) · FRED · Norges Bank · SSB (CC BY 4.0) · OpenVan.
