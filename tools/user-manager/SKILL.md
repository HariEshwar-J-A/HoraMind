---
name: user-manager
description: User profile management and session isolation enforcement. MUST be called at the start of every session before any other tool. Enforces the rule that users can only access their own natal chart.
version: 1.0.0
emoji: 🔐
user-invocable: false
disable-model-invocation: false
command-dispatch: false

metadata:
  openclaw:
    requires:
      bins:
        - node
      os:
        - linux
        - darwin
        - win32
---

# user-manager

Manages user profiles and enforces **strict per-user data isolation**. This is the security gate for HoraMind.

## ⚠️ MANDATORY FIRST CALL

**You MUST call this skill with `"action": "session_start"` as the VERY FIRST action in every session, before any other tool or response.** Pass the current user's Telegram ID as `requesting_id`.

## Security Model

| User Type | Can Access |
|-----------|-----------|
| Regular user | ONLY their own `users/{their_telegram_id}/` data |
| Admin (in settings.json) | Any user's data |

Cross-user access is **rejected at the tool level** with an error — the AI cannot override this.

## Invocation

```bash
node ./tools/user_manager.js '<json_input>'
```

## Actions

### `session_start` — REQUIRED first call

Identifies the user and returns their onboarding status.

```json
{ "action": "session_start", "requesting_id": "{{sender.id}}" }
```

Returns:
- `is_onboarded`: boolean — whether master_karmic_blueprint.md exists
- `has_profile`: boolean — whether birth data has been saved
- `is_admin`: boolean — whether this user has admin privileges
- `blueprint_path`: path to blueprint if onboarded

### `save_birth` — Store birth details

```json
{
  "action": "save_birth",
  "requesting_id": "{{sender.id}}",
  "target_id": "{{sender.id}}",
  "birth_data": {
    "date": "YYYY-MM-DD",
    "time": "HH:MM:SS",
    "lat": 13.0878,
    "lon": 80.2785,
    "timezone": "Asia/Kolkata",
    "ayanamsa": "LAHIRI",
    "city": "Chennai, India",
    "name": "Optional name"
  }
}
```

Admin can set `target_id` to a different user ID to save data for another user.

### `get_profile` — Retrieve stored birth data

```json
{ "action": "get_profile", "requesting_id": "{{sender.id}}", "target_id": "{{sender.id}}" }
```

### `is_onboarded` — Check onboarding status

```json
{ "action": "is_onboarded", "requesting_id": "{{sender.id}}", "target_id": "{{sender.id}}" }
```

### `list_users` — Admin only: list all users

```json
{ "action": "list_users", "requesting_id": "{{sender.id}}" }
```

## Rules

1. Always set `requesting_id` to the **current session's Telegram user ID** (`{{sender.id}}`).
2. For regular users, `target_id` must always equal `requesting_id`.
3. Only admins may set `target_id` to a different user.
4. If the tool returns `{ "error": "Access denied..." }`, STOP immediately and tell the user they can only access their own chart.
