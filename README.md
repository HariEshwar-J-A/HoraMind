# HoraMind 🪐

By [Harieshwar Jagan Abirami](https://github.com/HariEshwar-J-A)

HoraMind is an autonomous Vedic Astrology AI agent built on the [OpenClaw](https://openclaw.ai/) framework. It accepts birth details over Telegram, calculates precise multi-stage charts using the [`node-jhora`](https://github.com/HariEshwar-J-A/node-jhora) engine, grounds every interpretation in classical BPHS texts via a local ChromaDB RAG database, and synthesises everything into a permanent **Master Karmic Blueprint** for each user.

---

## Features

- **Precision Astrological Engine:** D1 through D30 divisional charts, Shadbala (6-fold planetary strength), Ashtakavarga transit grid, and Vimshottari Dasha timeline — all from the `node-jhora` Swiss Ephemeris WASM backend.
- **Classical RAG Database:** Every interpretive claim is sourced from BPHS (Brihat Parashara Hora Shastra) chunks stored in JyotishBase/ChromaDB.
- **Conflict Resolution Matrix:** Hard-wired priority rules ensure the AI never contradicts itself: Dasha Trigger → Shadbala → Neecha Bhanga → D1 Primacy.
- **Persistent Karmic Blueprints:** Per-user Markdown files so the agent remembers your chart across every session.
- **Rate Limiting:** 5 open-ended queries per user per day (resets at midnight EST).
- **Telegram Native:** Whitelist-gated DM bot. No group chats. No command menus — pure conversation.

---

## Architecture

```
HoraMind/                          ← OpenClaw workspace root (workspace: ".")
│
├── openclaw.json                  ← Gateway config — gitignored, copy from .env.example
├── openclaw.example.json          ← Committed template for openclaw.json
├── .env                           ← API keys — gitignored, copy from .env.example
├── .env.example                   ← Committed template for .env
├── start.sh                       ← Launcher: sources .env, registers auth, starts gateway
├── stop.sh                        ← Safe shutdown: kills gateway + wipes API key from disk
├── package.json                   ← Node.js dependencies + npm scripts
│
├── SOUL.md                        ← Agent core identity + Conflict Resolution Matrix
├── AGENTS.md                      ← Operating instructions + onboarding pipeline
├── IDENTITY.md                    ← Agent name, emoji, communication style
├── TOOLS.md                       ← Tool registry and invocation guide
│
├── tools/                         ← Custom OpenClaw skills
│   ├── calculate_chart.js         ← node-jhora switchboard (CORE/VARGAS/ASHTAKAVARGA/DASHA)
│   ├── query_bphs_rag.js          ← ChromaDB semantic search (WASM embeddings)
│   ├── check_rate_limit.js        ← Per-user daily quota (5 queries/day, EST reset)
│   ├── calculate-chart/
│   │   └── SKILL.md               ← OpenClaw skill definition
│   ├── query-bphs-rag/
│   │   └── SKILL.md               ← OpenClaw skill definition
│   └── check-rate-limit/
│       └── SKILL.md               ← OpenClaw skill definition
│
├── agent_config/                  ← Legacy config directory (not the workspace)
│   ├── openclaw_config.json       ← Reference notes (not read by OpenClaw directly)
│   └── preferences.md             ← Reference notes
│
├── core/                          ← Mount node-jhora monorepo here (submodule or symlink)
│
├── users/                         ← Per-user data — gitignored, auto-created at runtime
│   └── {telegram_id}/
│       ├── 01_core_foundation.md  ← D1, D9, Shadbala analysis
│       ├── 02_varga_analysis.md   ← D2–D30 divisional charts
│       ├── 03_ashtakavarga.md     ← SAV transit grid
│       ├── 04_dasha_timeline.md   ← Vimshottari Dasha tree
│       └── master_karmic_blueprint.md  ← Final synthesis — read on every return visit
│
└── rate_limits.json               ← Rate limit state — gitignored, auto-created at runtime
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 22 | Required by OpenClaw |
| npm ≥ 10 | For package management |
| [node-jhora](https://github.com/HariEshwar-J-A/node-jhora) monorepo | Built adjacent at `../node-jhora/` |
| [JyotishBase](https://github.com/HariEshwar-J-A/JyotishBase) ChromaDB | Running and accessible at your configured URL |
| OpenRouter account | API key for LLM access (Claude + Gemini) |
| Telegram Bot Token | From `@BotFather` — see Step 1 below |

---

## Step 1: Create Your Telegram Bot with @BotFather

### 1.1 — Open BotFather

Open Telegram and search for **`@BotFather`** (the official blue-tick Telegram bot). Start a chat.

### 1.2 — Create a New Bot

Send the `/newbot` command and follow the prompts:

```
/newbot
```

BotFather will ask for:

**a) A display name** — shown in the chat list.
Example: `HoraMind Vedic Astrologer`

**b) A username** — must end in `bot`, no spaces, globally unique.
Example: `horamind_vedic_bot` or `HoraMindBot`

### 1.3 — Save Your Token

BotFather will reply with a token like:

```
Use this token to access the HTTP API:
7123456789:AAHdqTcvCH1vGWJxfSeofSs35NVi4jsaz38
Keep your token secure and store it safely.
```

**Copy the token.** You will paste it directly into `openclaw.json` in Step 3.

### 1.4 — Optional: Polish the Bot Profile (Recommended)

```
/setdescription
→ A precision Vedic Astrology advisor. Send your birth details to receive your
  complete Jyotish reading based on classical BPHS texts.

/setabouttext
→ HoraMind analyses your birth chart using the node-jhora engine and
  Brihat Parashara Hora Shastra. 5 free queries/day.

/setjoingroups
→ Disable

/setprivacy
→ Enable
```

---

## Step 2: Install Dependencies

```bash
# HoraMind's own Node.js packages
npm install

# OpenClaw gateway (global — required to run the agent)
npm install -g openclaw@latest
```

Verify:
```bash
openclaw --version
```

---

## Step 3: Configure `openclaw.json`

`openclaw.json` is **gitignored** because it holds your real bot token. Copy the template:

```bash
cp openclaw.example.json openclaw.json
```

Open `openclaw.json` and make two edits:

**a) Set your bot token** (from Step 1.3):
```json
"botToken": "7123456789:AAHdqTcvCH1vGWJxfSeofSs35NVi4jsaz38"
```

**b) Set your Telegram user ID** in the whitelist (find yours by messaging `@userinfobot`):
```json
"whitelist": [123456789]
```

Everything else in `openclaw.json` can stay as-is. The `anthropic/claude-sonnet-4-6` and `google/gemini-2.5-flash` models are routed through OpenRouter automatically using the `OPENROUTER_API_KEY` from your `.env`.

---

## Step 4: Configure `.env`

`.env` is **gitignored**. Copy the template:

```bash
cp .env.example .env
```

Fill in your values:

```env
# OpenRouter API key — https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# ChromaDB URL (JyotishBase vector DB)
# Use localhost:8000 if running on the same machine,
# or your VM's LAN IP if running remotely.
CHROMA_URL=http://localhost:8000
```

> **Note:** `TELEGRAM_BOT_TOKEN` is NOT in `.env` — it lives directly in `openclaw.json`
> because OpenClaw reads channel credentials from its own config, not the environment.

---

## Step 5: Build node-jhora

`calculate_chart.js` resolves node-jhora packages from `../node-jhora/packages/*/dist/`.
Make sure the monorepo is built before starting HoraMind:

```bash
cd ../node-jhora
npm install
npm run build
cd ../HoraMind
```

---

## Step 6: Start JyotishBase ChromaDB

`query_bphs_rag.js` connects to ChromaDB at your configured `CHROMA_URL`.
Start the database before launching HoraMind:

```bash
cd ../JyotishBase
chroma run --path ./chroma_data --host 0.0.0.0 --port 8000
```

Leave this running in a separate terminal, or set it up as a background service (see Production section below).

---

## Step 7: Launch HoraMind

```bash
# Make the launcher executable (one-time)
chmod +x start.sh

# Start the gateway
npm start
```

`start.sh` does the following before handing off to OpenClaw:
1. Changes directory to the HoraMind root so all relative paths resolve correctly.
2. Sources `.env` — injects `OPENROUTER_API_KEY` and `CHROMA_URL` into the process environment.
3. Validates that `OPENROUTER_API_KEY` is set.
4. **Bootstraps the OpenClaw agent auth store** — writes `OPENROUTER_API_KEY` into `~/.openclaw/agents/main/agent/auth-profiles.json` on first run. This is a separate file from `openclaw.json`; OpenClaw resolves model API keys from it, not from the process environment. Subsequent runs detect the key is already registered and skip this step.
5. Launches the gateway.

You should see:
```
[horamind] Loaded .env
[horamind] Registered OpenRouter API key in agent auth store.
[horamind] Starting OpenClaw gateway...
[horamind] Workspace : /home/hari/agents/astrology/HoraMind
[horamind] Config    : /home/hari/agents/astrology/HoraMind/openclaw.json
[openclaw] Gateway starting on 127.0.0.1:3001
[openclaw] Telegram channel: connected (@HoraMindBot)
[openclaw] Skills loaded: calculate-chart, query-bphs-rag, check-rate-limit
[openclaw] Agent workspace: /home/hari/agents/astrology/HoraMind
[openclaw] Default model: openrouter/anthropic/claude-sonnet-4-6
[openclaw] Ready. Listening for messages...
```

> **Why `openrouter/` prefix on model IDs?**
> OpenClaw parses the first segment of a model ID as the provider. Without the prefix,
> `anthropic/claude-sonnet-4-6` is treated as a direct Anthropic API call (requiring an
> Anthropic API key). With `openrouter/anthropic/claude-sonnet-4-6`, OpenClaw routes the
> request through OpenRouter using the registered `openrouter:default` profile.

### Test the bot

Open Telegram, find your bot by username, and send: `Hello`

The agent will greet you and ask for your birth details to begin onboarding.

---

## Production Deployment (Ubuntu VM)

### Option A — pm2 (Recommended)

```bash
npm install -g pm2

# Run start.sh once manually first so the auth store gets bootstrapped,
# then hand off to pm2 for process management on subsequent restarts.
chmod +x start.sh
./start.sh &   # let it register auth, then Ctrl+C
pm2 start ./start.sh --name horamind

# Persist across reboots
pm2 save
pm2 startup
```

### Option B — Two-terminal quick-start

```bash
# Terminal 1 — ChromaDB
cd /path/to/JyotishBase
chroma run --path ./chroma_data --host 0.0.0.0 --port 8000

# Terminal 2 — HoraMind
cd /path/to/HoraMind
npm start
```

### Option C — systemd service

Create `/etc/systemd/system/horamind.service`:

```ini
[Unit]
Description=HoraMind Vedic Astrology Bot
After=network.target

[Service]
Type=simple
User=hari
WorkingDirectory=/home/hari/agents/astrology/HoraMind
ExecStart=/bin/bash /home/hari/agents/astrology/HoraMind/start.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable horamind
sudo systemctl start horamind
```

---

## Debugging the Tools Standalone

Each tool script can be run independently to verify it works before launching the full agent:

```bash
# Tool 1 — chart calculation (Chennai birth example)
node tools/calculate_chart.js '{"date":"1996-12-07","time":"10:34:00","lat":13.0878,"lon":80.2785,"ayanamsa":"LAHIRI","calculation_type":"CORE_CHARTS","timezone":"Asia/Kolkata"}'

# Tool 2 — RAG search
node tools/query_bphs_rag.js "Effects of Rahu in 9th house from Lagna"

# Tool 3 — rate limiter peek (read-only, does not increment)
node tools/check_rate_limit.js 123456789 --peek
```

Or use the npm aliases:

```bash
npm run tools:test-chart
npm run tools:test-rag
npm run tools:test-rate
```

---

## Rate Limits

- Each Telegram user gets **5 open-ended interpretive queries per day**.
- The counter resets at **midnight Eastern Time (EST/EDT)**.
- The **onboarding pipeline** (first-time chart generation) is free — it does not consume query slots.
- Users can check their quota by asking: *"How many queries do I have left today?"*
- Quota state is stored in `rate_limits.json` at the workspace root (auto-created, gitignored).

---

## Stopping HoraMind Safely

**Always use `stop.sh` to shut down — never just `Ctrl+C` or `kill`.** The gateway writes your `OPENROUTER_API_KEY` into `~/.openclaw/agents/main/agent/auth-profiles.json` in plaintext on startup. `stop.sh` kills the process and immediately wipes that file so the key does not persist on disk between sessions.

```bash
# Full shutdown: stop gateway + wipe key
npm run stop        # or: ./stop.sh

# Key wipe only (use this after a crash where the process is already dead)
npm run revoke      # or: ./stop.sh --revoke-only
```

The key is automatically re-injected the next time you run `npm start`.

### What `stop.sh` does

1. **Detects the process** — checks pm2 first, then falls back to `pgrep` on `openclaw gateway`.
2. **Graceful shutdown** — sends `SIGTERM` and waits up to 5 seconds; escalates to `SIGKILL` only if the process ignores it.
3. **Atomically wipes the key** — writes a placeholder `auth-profiles.json` (empty `apiKey`) via temp-file + rename so there is no window where the file is partially written.

### `--revoke-only` mode

If the process crashed or was killed externally, the auth store still holds the key. Run:

```bash
./stop.sh --revoke-only
```

This skips process management entirely and only clears the auth store.

---

## Key Files Reference

| File | Purpose | Gitignored? |
|---|---|---|
| `openclaw.json` | Live gateway config (holds bot token) | ✅ Yes |
| `openclaw.example.json` | Committed template for `openclaw.json` | No |
| `.env` | API keys and service URLs | ✅ Yes |
| `.env.example` | Committed template for `.env` | No |
| `start.sh` | Launcher — env loading, auth bootstrap, gateway start | No |
| `stop.sh` | Safe shutdown — kills gateway + wipes API key from auth store | No |
| `SOUL.md` | Agent persona + Conflict Resolution Matrix | No |
| `AGENTS.md` | Onboarding pipeline + operating rules | No |
| `IDENTITY.md` | Agent name, tone, communication style | No |
| `TOOLS.md` | Tool registry and invocation guide | No |
| `users/` | Per-user karmic blueprints and chart files | ✅ Yes |
| `rate_limits.json` | Daily query counter per user | ✅ Yes |

---

## Related Projects

- [**JyotishBase**](https://github.com/HariEshwar-J-A/JyotishBase) — The open-source BPHS vector database. Clone this to build and run the ChromaDB collection that HoraMind queries.
- [**Node-Jhora**](https://github.com/HariEshwar-J-A/node-jhora) — The TypeScript Vedic Astrology calculation engine powering the `calculate_chart.js` tool.

---

## License

Licensed under the **PolyForm Noncommercial License 1.0.0**. Free for personal and research use. Commercial use requires a separate agreement — see [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md).
