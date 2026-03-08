# OpenClaw Configuration Guide (`openclaw.json`)

This document explains the configuration structure for the HoraMind OpenClaw Gateway since JSON does not support comments natively.
Environment variables are referenced as `$env.VAR_NAME`.
Documentation: [https://docs.openclaw.ai/gateway/configuration](https://docs.openclaw.ai/gateway/configuration)

## 1. Gateway
Configures the local HTTP server (not exposed publicly).
- **port**: `3001`
- **bind**: `"127.0.0.1"`

## 2. Agents Defaults
The `workspace` directory maps to our `agent_config/` folder.
OpenClaw reads `SOUL.md`, `AGENTS.md`, `IDENTITY.md`, `TOOLS.md` from here.
- **model**: `"claude-3-7-sonnet"` (Default: heavy reasoning model)

## 3. Model Registry
Models are registered via OpenRouter (OpenAI-compatible endpoint). Both use the same `OPENROUTER_API_KEY`. OpenRouter auto-routes to the specific model provider.

- **`claude-3-7-sonnet`**: Heavy astrological analysis & synthesis. Low temperature (`0.3`) for precise astrological logic.
- **`gemini-2-5-flash`**: Lightweight chat, status replies, onboarding ACKs. Higher temperature (`0.7`) for conversational replies.

## 4. Channels
Currently only Telegram is enabled.
- **dmPolicy**: `"open"` allows any user to DM the bot. Set to `"allowlist"` and populate `allowFrom[]` to restrict access.
- **groupPolicy**: `"disabled"` ensures the bot operates in DMs only.

## 5. Skills
Loads our three custom tools from the `./tools` directory. Each skill must be a sub-directory containing a `SKILL.md` file.

- **`calculate-chart`**
- **`query-bphs-rag`**: Passes `$env.CHROMA_URL` to the skill environment.
- **`check-rate-limit`**
