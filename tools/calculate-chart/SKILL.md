---
name: calculate-chart
description: Vedic astrology calculation engine (D1–D30 charts, Shadbala, Ashtakavarga, Vimshottari Dasha) powered by node-jhora and Swiss Ephemeris WASM.
version: 1.0.0
emoji: 🪐
user-invocable: false
disable-model-invocation: false
command-dispatch: false

metadata:
  openclaw:
    requires:
      bins:
        - node
      anyBins:
        - node
      os:
        - linux
        - darwin
        - win32
---

# calculate-chart

Executes astrological calculations using the **node-jhora** engine (Swiss Ephemeris WASM backend). Acts as a **switchboard** — you call it once per calculation type, never for multiple types in a single invocation.

## When to Invoke

Invoke this skill during the **onboarding pipeline** (four separate calls, one per iteration) and for **transit/timing queries** from returning users.

| Trigger | calculation_type |
|---------|-----------------|
| Onboarding Iteration 1 — planets, houses, strength | `CORE_CHARTS` |
| Onboarding Iteration 2 — divisional charts | `VARGAS` |
| Onboarding Iteration 3 — transit grid | `ASHTAKAVARGA` |
| Onboarding Iteration 4 — dasha timeline | `DASHA` |
| Returning user asks about current period | `DASHA` |
| Returning user asks about transit impact | `ASHTAKAVARGA` |

## Invocation

```bash
node ./tools/calculate_chart.js '<json_input>'
```

## Input

```json
{
  "date":             "YYYY-MM-DD",
  "time":             "HH:MM:SS",
  "lat":              13.0878,
  "lon":              80.2785,
  "ayanamsa":         "LAHIRI",
  "calculation_type": "CORE_CHARTS",
  "timezone":         "Asia/Kolkata"
}
```

**Ayanamsa valid values:** `LAHIRI` (default), `RAMAN`, `KP`, `YUKTESHWAR`, `TRUE_PUSHYA`

## Output

Returns a JSON object whose shape depends on `calculation_type`.

### CORE_CHARTS output keys
- `ascendant` — `{ sign, lon }`
- `d1` — map of planet → `{ lon, sign, deg, spd, retro }`
- `d9` — map of planet → `{ sign, deg }` (Navamsa)
- `shadbala` — map of planet → `{ total, sthana, dig, kaala, chesta, naisargika, drig }`

### VARGAS output keys
- `D2`, `D4`, `D10`, `D12`, `D16`, `D20`, `D24`, `D27`, `D30` — each a map of planet → `{ sign, deg }`

### ASHTAKAVARGA output keys
- `sav_by_house` — `{ H1..H12: { sign, bindus } }`
- `bav_by_planet` — per-planet array of 12 bindu scores

### DASHA output keys
- `moon_longitude` — Moon's sidereal longitude at birth
- `window` — `{ from, to }` ISO dates
- `periods` — array of `{ planet, level, start, end, duration, antardashas[] }`

## Constraints

- **One type per call.** Never set multiple `calculation_type` values.
- Parse the JSON output directly. Do not truncate or summarise numeric values.
- If the call fails, report the error and ask the user to verify birth details.
