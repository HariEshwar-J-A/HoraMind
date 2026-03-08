---
name: check-rate-limit
description: Enforces the 5-query-per-day limit per Telegram user. Reads and writes a local rate_limits.json file. Resets at midnight EST (America/New_York).
version: 1.0.0
emoji: ⏱️
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

# check-rate-limit

Manages the per-user daily query quota. State is persisted to `/rate_limits.json` at the HoraMind root. The day boundary is defined as **midnight in the America/New_York (EST/EDT) timezone** — consistent regardless of server timezone.

## When to Invoke

| Situation | Mode | Action |
|-----------|------|--------|
| User sends any open-ended interpretive question | Increment | Call before responding. Honour the result. |
| User asks "How many queries do I have left?" | Peek | Use `--peek` flag — does NOT consume a query slot. |
| Status display at end of a reply | Peek | Use `--peek` to get the current count for the footer. |
| During the onboarding pipeline | **Never** | Onboarding is always free — do not gate it. |
| Simple bot ACKs ("Calculating...", "Got it") | **Never** | Only gate substantive interpretive replies. |

## Invocation

```bash
# Increment mode (call BEFORE generating an interpretive reply)
node ./tools/check_rate_limit.js <telegram_id>

# Peek mode (read-only — does NOT increment)
node ./tools/check_rate_limit.js <telegram_id> --peek
```

`<telegram_id>` is the numeric Telegram user ID string (e.g., `123456789`).

## Output

```json
{
  "allowed": true,
  "used": 3,
  "remaining": 2,
  "limit": 5,
  "reset_at": "2026-03-09T05:00:00.000Z"
}
```

| Field | Meaning |
|-------|---------|
| `allowed` | `true` = proceed; `false` = block and show reset time |
| `used` | Queries consumed today (after this call in increment mode) |
| `remaining` | Queries left today |
| `limit` | Always 5 |
| `reset_at` | ISO timestamp of next midnight EST reset |

## Decision Logic

```
if allowed == false:
    reply: "You've reached today's 5-query limit 🌙.
            Your quota resets at midnight EST ({reset_at} UTC).
            Come back tomorrow and we'll continue your reading."
    STOP — do not proceed with the astrological reply.

if allowed == true:
    proceed with the interpretation.
    append to end of reply: "Queries remaining today: {remaining}/5"
```

## Notes

- The rate limit file is stored at `/rate_limits.json` (gitignored).
- Writes are atomic (temp-file + rename) — no data corruption on crash.
- The `--peek` mode is idempotent and safe to call at any time.
