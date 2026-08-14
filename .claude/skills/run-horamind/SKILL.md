---
name: run-horamind
description: Build, run, and drive HoraMind — the Fastify API and the React PWA. Use when asked to start HoraMind, launch the API or web client, run its tests, take a screenshot of the UI, interpret a chart, or check that the stack still works end to end.
---

HoraMind is a Fastify API (`:8080`) plus a React/Vite PWA (`:5173`) over Postgres,
in one npm-workspaces monorepo. Drive both with
`.claude/skills/run-horamind/driver.mjs` — it exercises the real HTTP surface and
the real PWA in headless Chrome over the DevTools Protocol. **Zero dependencies:
no Playwright, no browser download.** Paths below are relative to the repo root.

Verified on macOS 15 (arm64), Node 25, Chrome 151. Docker is *not* used — see
Gotchas.

## Prerequisites

Node 22+, a Homebrew Postgres, and (only for the `web` driver) Chrome. All three
were already present on this machine; confirm with:

```bash
node --version && /opt/homebrew/bin/postgres --version
```

```
v25.9.0
postgres (PostgreSQL) 17.9 (Homebrew)
```

If Postgres is missing, `brew install postgresql@17` is the formula — untested
here, because `brew install` fails on this machine with `Permission denied @
rb_check_realpath_internal - /opt/homebrew/var/homebrew/linked/postgresql@17`.
Fix that first if you hit it.

## Setup

`.env` is required and gitignored; nothing in the repo loads it automatically
(no `dotenv`, no `--env-file`), so every command below sources it explicitly.

```bash
cp .env.example .env
```

Then edit `.env`:

- `JWT_SECRET` — required, min 32 chars: `openssl rand -base64 48`
- `POSTGRES_PASSWORD` — any value; must match `DATABASE_URL`
- `DATABASE_URL` — must point at **port 55432**, not 5432 (see Gotchas):
  `postgres://horamind:<password>@localhost:55432/horamind`
- `OPENROUTER_API_KEY` — optional; without it `/v1/interpret` returns 503 and
  everything else still works
- `OPENROUTER_MODEL_FREE` — **must not** be the shipped default (see Gotchas):
  `google/gemini-2.5-flash`

```bash
npm install
npm run build
```

## Run

Three processes. Postgres via the repo script; the other two in the foreground
where their logs are readable and they hot-reload.

```bash
./infra/scripts/dev-local.sh start
```

```bash
set -a && . ./.env && set +a && npm run dev
```

```bash
npm run dev --workspace @horamind/web
```

Check all three at once:

```bash
./infra/scripts/dev-local.sh status
```

```
postgres  :55432  up    (/Users/you/.local/share/horamind/pgdata)
api      :8080   up
web      :5173   up
```

## Drive it (agent path)

```bash
node .claude/skills/run-horamind/driver.mjs all
```

`api` and `web` run the halves separately. Exit code is 0 only if every step
passed, so it works as a smoke gate.

`api` walks health → `/ready` → register-or-login → places → profile → all five
chart endpoints → memories → interpret, asserting real invariants rather than
just status codes (Rahu and Ketu exactly opposed; `birthDate` still matching
`YYYY-MM-DD` after the round trip). On failure it prints the server's `requestId`
— grep the API log for it to get the stack.

`web` drives the PWA in headless Chrome: sign in, read the chart, **reload to
prove the session survives**, save a memory, ask a question. Screenshots land in
`$TMPDIR/horamind-run/` (`today.png`, `chart.png`, `you.png`, `ask.png`).
Override with `HORAMIND_OUT=/some/dir`.

```
PASS GET /v1/charts/natal (ephemeris)  asc Scorpio 29.91°, 9 grahas, nodes opposed
PASS session survives a reload  stayed on /chart
all steps passed  screenshots: /var/folders/.../horamind-run
```

The driver uses a fixed account (`driver@horamind.local`) and reuses it on later
runs — registration returning 409 is expected and handled.

Env knobs: `HORAMIND_API`, `HORAMIND_WEB`, `HORAMIND_OUT`, `HORAMIND_CHROME`,
`HORAMIND_CDP_PORT`.

## Audit the UI

```bash
node .claude/skills/run-horamind/audit.mjs /tmp/hm-audit 390 844 9470
```

Signs in and walks every screen and section — sign-in, Today, Chart in both
conventions, the dial, the planet table, Calendar, Ask, You and the life
reading — writing a numbered PNG per stop at 2x device scale. Arguments are
`<outDir> <width> <height> <cdpPort>`; run it twice, once at 390x844 and once at
1280x900, since this app is mobile-first and the two disagree.

It reports page height and horizontal overflow per shot, because overflow is
the defect a screenshot *hides*: the page looks fine and the content is off the
right edge. **Look at the images.** The three defects this caught last time —
a day strip opening on the oldest day with today half-clipped, a visible
scrollbar, and a per-day mark that was identical on all fifteen days — were all
invisible to every assertion in the driver.

## Test

```bash
set -a && . ./.env && set +a && export LC_ALL=C && npm test
```

160 tests. The API integration suite needs Postgres up. Also:

```bash
npm run typecheck
```

```bash
npm run lint
```

## Gotchas

- **Postgres must run on 55432.** Port 5432 on this machine belongs to another
  project's container (`infosentry-db`), as does 8000 (`infosentry-chroma`).
  `dev-local.sh` uses a HoraMind-only cluster at `~/.local/share/horamind/pgdata`
  and never touches either. `.env` points Chroma at 8001 for the same reason —
  so a misconfigured HoraMind cannot talk to the other project's vector store.

- **Postgres needs `LC_ALL=C` on macOS** or it dies at startup with
  `postmaster became multithreaded during startup` — libc's locale lookup spawns
  threads and Postgres refuses to fork a multithreaded postmaster. Nothing about
  the message suggests locales. `dev-local.sh` exports it; if you start Postgres
  by hand, you must too.

- **Docker cannot start containers here.** containerd fails with
  `failed to create new OS thread (errno=11)`. That is why Postgres is native.
  Separately, the README's `docker compose -f infra/docker/docker-compose.yml up`
  never reads the root `.env` — Compose resolves `.env` against the *compose
  file's* directory, so it dies on `JWT_SECRET is required`. Use
  `--env-file .env` if you revive the Docker path.

- **`OPENROUTER_MODEL_FREE`'s shipped default is dead.**
  `meta-llama/llama-3.3-70b-instruct:free` was retired; OpenRouter rejects it and
  names the paid slug. Worse, the paid `meta-llama/llama-3.3-70b-instruct`
  returns **HTTP 200 with a hollow choice** (null content, no `tool_calls`, no
  `usage`) whenever OpenRouter routes it to **DeepInfra** — the identical request
  succeeds on AkashML. HoraMind reports this as "The model returned an empty
  response". Pin a single-provider model (`google/gemini-2.5-flash`) so there is
  no routing roulette.

- **RAG returns 503 and that is fine.** The JyotishBase corpus is not on this
  machine, so `/v1/rag/query` fails and interpretations say the classical texts
  are unavailable. Neither blocks `/ready`, which checks only Postgres and the
  ephemeris — deliberately, so a retrieval outage cannot pull the process out of
  a load balancer.

- **Setting `.value` on a React input does nothing.** React installs its own
  value setter and tracks the last value it wrote, so a direct assignment is
  invisible to `onChange`; the form submits empty and *silently* does nothing.
  The driver's `__hmSet` calls the native prototype setter and dispatches a
  bubbling `input` event. Reuse it rather than rediscovering this.

- **CDP: re-inject helpers on every document.** A `Page.reload` throws away the
  JS context, so anything injected with a bare `Runtime.evaluate` vanishes and
  the *next* step dies with `__hmClick is not defined`, far from the reload that
  caused it. The driver uses `Page.addScriptToEvaluateOnNewDocument`.

- **`location.pathname` is not a readiness signal.** It updates before React
  decides what to render. While the session store restores after a reload the
  route guard shows a splash with *no tab bar*, so a click issued as soon as the
  path looks right fails with `no clickable matching: you` — intermittently,
  depending on how fast `/v1/profiles` answers. Wait for the element itself; the
  driver's `clickWhenReady` does.

- **CDP: `returnByValue` cannot serialise a DOM node.**
  `document.querySelector('textarea')` fails with `Object reference chain is too
  long` instead of being truthy. The driver wraps every wait in `Boolean(...)`.

- **CDP: filter `/json/list` to `type === 'page'`.** Current Chrome also returns
  `browser_ui` and extension targets, and not always last.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/ready` 503 with `"database": false` | Postgres down, or `DATABASE_URL` on 5432. `./infra/scripts/dev-local.sh status`. Check `DATABASE_SSL=false` is honoured — TLS against a non-TLS Postgres fails exactly this way. |
| `postmaster became multithreaded during startup` | `export LC_ALL=C` before starting Postgres. |
| `psql` hangs at a password prompt | `PGPASSWORD` unset. Source `.env` first; `dev-local.sh` exports it and passes `-w`. |
| `JWT_SECRET is required` from `docker compose` | Compose is not reading the root `.env`. Add `--env-file .env`. |
| `/v1/interpret` 502 "empty response" | OpenRouter routed to DeepInfra. Pin `OPENROUTER_MODEL_FREE=google/gemini-2.5-flash`. |
| `/v1/interpret` 503 | `OPENROUTER_API_KEY` empty. Expected; the rest of the app works. |
| Driver: `__hmClick is not defined` | Helpers lost to a navigation — inject via `Page.addScriptToEvaluateOnNewDocument`. |
| Driver: `Object reference chain is too long` | A wait expression returns a DOM node. Wrap it in `Boolean(...)`. |
| Web 400 `VALIDATION_ERROR` on a query | Param names are exact: places search takes `query`, not `q`; memories take `whatHappened`/`whatILearnt`, and the schema is `additionalProperties: false`. |
