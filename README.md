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
- **Telegram Native:** Single-user DM bot. No group chats. No command menus — pure conversation.

---

## Architecture

```
HoraMind/
├── openclaw.json              ← OpenClaw gateway config (models, channels, skills)
├── .env                       ← API keys (gitignored — copy from .env.example)
├── .env.example               ← Template
├── package.json               ← Node.js dependencies
│
├── agent_config/              ← OpenClaw workspace directory
│   ├── SOUL.md                ← Core identity + Conflict Resolution Matrix
│   ├── AGENTS.md              ← Operating instructions + onboarding pipeline
│   ├── IDENTITY.md            ← Agent name, emoji, communication style
│   └── TOOLS.md               ← Tool registry and invocation guide
│
├── tools/                     ← Custom OpenClaw skills
│   ├── calculate_chart.js     ← node-jhora switchboard (D1/Vargas/AVarga/Dasha)
│   ├── query_bphs_rag.js      ← ChromaDB semantic search (WASM embeddings)
│   ├── check_rate_limit.js    ← Per-user daily quota (5 queries/day, EST reset)
│   ├── calculate-chart/       ← Skill definition
│   │   └── SKILL.md
│   ├── query-bphs-rag/        ← Skill definition
│   │   └── SKILL.md
│   └── check-rate-limit/      ← Skill definition
│       └── SKILL.md
│
├── core/                      ← Mount node-jhora monorepo here (submodule or symlink)
├── users/                     ← Per-user data (gitignored)
│   └── {telegram_id}/
│       ├── 01_core_foundation.md
│       ├── 02_varga_analysis.md
│       ├── 03_ashtakavarga.md
│       ├── 04_dasha_timeline.md
│       └── master_karmic_blueprint.md
└── rate_limits.json           ← Rate limit state (gitignored)
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 22 | Required by OpenClaw |
| npm ≥ 10 | For package management |
| [node-jhora](https://github.com/HariEshwar-J-A/node-jhora) monorepo | Built adjacent to this repo (`../node-jhora/`) |
| [JyotishBase](https://github.com/HariEshwar-J-A/JyotishBase) ChromaDB | Running on `localhost:8000` (or configured URL) |
| OpenRouter account | API key for LLM access |
| Telegram Bot Token | From `@BotFather` — see setup guide below |

---

## Step 1: Create Your Telegram Bot with @BotFather

This is the only Telegram configuration needed before running HoraMind.

### 1.1 — Open BotFather

Open Telegram and search for **`@BotFather`** (the official blue-tick bot from Telegram). Start a chat with it.

### 1.2 — Create a New Bot

Send the `/newbot` command:

```
/newbot
```

BotFather will ask you two things:

**a) A display name for your bot** — this is the friendly name users see in their chat list.
Example: `HoraMind Vedic Astrologer`

**b) A username for your bot** — must end in `bot`, no spaces, globally unique.
Example: `horamind_vedic_bot` or `HoraMindBot`

### 1.3 — Save Your Token

BotFather will reply with something like:

```
Done! Congratulations on your new bot. You will find it at t.me/HoraMindBot.
You can now add a description, about section and profile picture for your bot,
see /help for a list of commands.

Use this token to access the HTTP API:
7123456789:AAHdqTcvCH1vGWJxfSeofSs35NVi4jsaz38
Keep your token secure and store it safely, it can be used by anyone to control your bot.
```

**Copy the token.** This is your `TELEGRAM_BOT_TOKEN`. Keep it secret.

### 1.4 — Optional: Configure Your Bot (Recommended)

While you're in BotFather, run these optional commands to polish the experience:

**Set a description** (shown on the bot's profile page):
```
/setdescription
```
Suggested: `A precision Vedic Astrology advisor. Send your birth details to receive your complete Jyotish reading based on the BPHS classical texts.`

**Set an "About" text** (shown before the user starts a chat):
```
/setabouttext
```
Suggested: `HoraMind analyses your birth chart using the node-jhora engine and Brihat Parashara Hora Shastra. 5 free queries/day.`

**Disable join groups** (HoraMind is DM-only):
```
/setjoingroups
→ Choose: Disable
```

**Set privacy mode** (so the bot only sees direct messages, not all group messages):
```
/setprivacy
→ Choose: Enable
```

---

## Step 2: Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your real values:

```env
# From OpenRouter (https://openrouter.ai/keys)
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# From BotFather (Step 1 above)
TELEGRAM_BOT_TOKEN=7123456789:AAHdqTcvCH1vGWJxfSeofSs35NVi4jsaz38

# ChromaDB URL (where JyotishBase is running)
CHROMA_URL=http://localhost:8000
```

---

## Step 3: Install Dependencies

```bash
# Install HoraMind's own dependencies
npm install

# Install OpenClaw globally (required to run the gateway)
npm install -g openclaw@latest
```

Verify OpenClaw is available:
```bash
openclaw --version
```

---

## Step 4: Ensure node-jhora is Built

The `calculate_chart.js` tool resolves node-jhora packages from `../node-jhora/packages/*/dist/`. Make sure the monorepo is built:

```bash
cd ../node-jhora
npm install
npm run build
cd ../HoraMind
```

---

## Step 5: Start JyotishBase ChromaDB

The `query_bphs_rag.js` tool connects to ChromaDB. Start the JyotishBase database:

```bash
# In the JyotishBase directory
cd ../JyotishBase
chroma run --path ./chroma_data --host 0.0.0.0 --port 8000
```

Leave this running in a separate terminal or configure it as a background service.

---

## Step 6: Start HoraMind

```bash
# From the HoraMind directory
OPENCLAW_CONFIG_PATH=./openclaw.json openclaw gateway
```

Or use the npm start script (after setting it up in package.json):
```bash
npm start
```

You should see output like:
```
[openclaw] Gateway starting on 127.0.0.1:3001
[openclaw] Telegram channel: connected (@HoraMindBot)
[openclaw] Skills loaded: calculate-chart, query-bphs-rag, check-rate-limit
[openclaw] Agent workspace: ./agent_config
[openclaw] Default model: claude-3-7-sonnet (via OpenRouter)
[openclaw] Ready. Listening for messages...
```

### Test the bot
Open Telegram, search for your bot (`@YourBotUsername`), and send: `Hello`

The bot should greet you and ask for your birth details.

---

## Environment Setup for Production (Ubuntu VM)

For a persistent deployment on a Linux VM, use `pm2` or `systemd`.

### Using pm2:
```bash
npm install -g pm2

# Create an ecosystem config
pm2 start --name horamind \
  --env-file .env \
  -- sh -c 'OPENCLAW_CONFIG_PATH=./openclaw.json openclaw gateway'

# Persist across reboots
pm2 save
pm2 startup
```

### Two-terminal quick-start:
```bash
# Terminal 1 — ChromaDB
cd /path/to/JyotishBase && chroma run --path ./chroma_data

# Terminal 2 — HoraMind
cd /path/to/HoraMind && OPENCLAW_CONFIG_PATH=./openclaw.json openclaw gateway
```

---

## Rate Limits

- Each Telegram user gets **5 open-ended interpretive queries per day**.
- The counter resets at **midnight Eastern Time (EST/EDT)**.
- The onboarding pipeline (first-time setup) is **free** — it does not count toward the daily limit.
- Users can check their remaining quota by asking: *"How many queries do I have left?"*

---

## Project Structure Notes

- **`users/`** — Gitignored. Contains each user's karmic blueprint and iteration files.
- **`rate_limits.json`** — Gitignored. Auto-created on first use.
- **`agent_config/`** — The agent's "brain". Edit `SOUL.md` to change behaviour or add rules.
- **`tools/`** — The calculation and search backends. Each `.js` file can also be run standalone for debugging.

---

## Debugging the Tools

Test each tool independently before running the full agent:

```bash
# Test chart calculation (Chennai birth example)
node tools/calculate_chart.js '{"date":"1996-12-07","time":"10:34:00","lat":13.0878,"lon":80.2785,"ayanamsa":"LAHIRI","calculation_type":"CORE_CHARTS","timezone":"Asia/Kolkata"}'

# Test RAG search
node tools/query_bphs_rag.js "Effects of Rahu in 9th house from Lagna"

# Test rate limiter (peek — does not increment)
node tools/check_rate_limit.js 123456789 --peek
```

---

## Related Projects

- [**JyotishBase**](https://github.com/HariEshwar-J-A/JyotishBase) — The open-source BPHS vector database. Clone this to populate your ChromaDB.
- [**Node-Jhora**](https://github.com/HariEshwar-J-A/node-jhora) — The TypeScript Vedic Astrology calculation engine powering Tool 1.

---

## License

Licensed under the **PolyForm Noncommercial License 1.0.0**. Free for personal and research use. Commercial use requires a separate agreement — see [COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md).
