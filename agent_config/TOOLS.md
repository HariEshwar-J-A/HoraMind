# TOOLS.md — HoraMind Tool Registry

This file documents the three custom tools available to the HoraMind agent.
Read this file when deciding which tool to invoke and in what sequence.

---

## Tool 1: `calculate_chart` (calculate_chart.js)

**Purpose:** The astrological math engine. Interfaces with the node-jhora library
to perform Swiss Ephemeris calculations. Acts as a switchboard — call it once per
calculation type, never for all types in a single call.

**Invoke as:**
```bash
node ./tools/calculate_chart.js '<json_input>'
```

**Input Schema:**
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

**`calculation_type` values:**

| Value | Returns | When to Use |
|-------|---------|-------------|
| `CORE_CHARTS` | D1 planets, D9 Navamsa, Shadbala (all 7 components per planet) | Onboarding Iteration 1 only |
| `VARGAS` | D2, D4, D10, D12, D16, D20, D24, D27, D30 | Onboarding Iteration 2 only |
| `ASHTAKAVARGA` | SAV bindu scores per house + per-planet BAV | Onboarding Iteration 3 + transit queries |
| `DASHA` | Vimshottari Mahadasha + Antardasha tree (±10/20 yr window) | Onboarding Iteration 4 + timeline queries |

**`ayanamsa` valid values:** `LAHIRI`, `RAMAN`, `KP`, `KRISHNAMURTI`, `YUKTESHWAR`, `TRUE_PUSHYA`

**Output:** Compact JSON object. Structure varies by `calculation_type`.

**NEVER call this tool with all four types at once.** Each iteration call is separate.

---

## Tool 2: `query_bphs_rag` (query_bphs_rag.js)

**Purpose:** Semantic search against the JyotishBase ChromaDB vector database
(collection: `santhanam_source_of_truth`). Returns top-4 Markdown chunks from
BPHS and related classical texts.

**Invoke as:**
```bash
node ./tools/query_bphs_rag.js "your search query here"
```

**Input:** A natural-language string describing the astrological concept to look up.

**Example queries:**
```
"Effects of Rahu in the 9th house from Lagna"
"Sun Saturn conjunction results Vedic astrology"
"Vimshottari Dasha Moon Mahadasha Jupiter Antardasha"
"Neecha Bhanga Raja Yoga conditions cancellation debilitation"
"Ashtakavarga transit bindus Saturn 8th house"
"D10 Dashamsa career Mercury dominant sign Gemini"
```

**Output:** Array of up to 4 objects:
```json
[
  {
    "rank": 1,
    "score": 0.923456,
    "id": "doc_id_string",
    "document": "## BPHS Chapter 12 Sloka 4...\n\n[Full markdown chunk]",
    "metadata": { "chapter": "12", "source": "bphs", "tags": ["rahu", "9th_house"] }
  }
]
```

**When to use:** Run 2–3 targeted RAG queries after EVERY tool-1 call during onboarding.
Run 1 targeted query for specific daily questions. Never skip RAG for interpretive claims.

**Dependency:** ChromaDB must be running at `$CHROMA_URL` (default: `http://localhost:8000`).

---

## Tool 3: `check_rate_limit` (check_rate_limit.js)

**Purpose:** Enforce the 5-query-per-day limit per Telegram user.
Reads/writes `/rate_limits.json` at the HoraMind root. Resets at midnight EST.

**Invoke as:**
```bash
# Check and increment (call BEFORE responding to any open-ended interpretive query)
node ./tools/check_rate_limit.js <telegram_id>

# Peek only — does NOT increment counter (for status display)
node ./tools/check_rate_limit.js <telegram_id> --peek
```

**Output:**
```json
{
  "allowed": true,
  "used": 3,
  "remaining": 2,
  "limit": 5,
  "reset_at": "2026-03-09T05:00:00.000Z"
}
```

**When to call:**
- Call (increment mode) **before** generating any interpretive astrological response.
- Call (peek mode) to display quota status without consuming a query.
- Do NOT call during the onboarding pipeline itself — onboarding is free.
- Do NOT call for simple acknowledgments like "Got it" or "Calculating...".

**If `allowed: false`:** Stop immediately. Reply with the reset time. Do not proceed.

---

## Tool Invocation Order Summary

### New User Onboarding (Sequential):
```
1. [No rate limit check — onboarding is free]
2. calculate_chart → CORE_CHARTS
3. query_bphs_rag × 3 (for lagna, moon sign, dominant yoga)
4. → Write 01_core_foundation.md
5. calculate_chart → VARGAS
6. query_bphs_rag × 2 (for D10 career, D2 wealth)
7. → Write 02_varga_analysis.md
8. calculate_chart → ASHTAKAVARGA
9. query_bphs_rag × 1 (for weakest house)
10. → Write 03_ashtakavarga.md
11. calculate_chart → DASHA
12. query_bphs_rag × 2 (for current Mahadasha + Antardasha lords)
13. → Write 04_dasha_timeline.md
14. [Synthesise all 4 files] → Write master_karmic_blueprint.md
15. Send blueprint summary to user
```

### Returning User Daily Query:
```
1. Read master_karmic_blueprint.md silently
2. check_rate_limit → {telegram_id} [increment mode]
   → If denied: reply with reset time, stop.
3. [Optional] calculate_chart → DASHA or ASHTAKAVARGA (if transit/timing question)
4. query_bphs_rag × 1-2 (for specific question topic)
5. Reply with chart-anchored interpretation
6. Append "Remaining queries today: {n}/5"
```
