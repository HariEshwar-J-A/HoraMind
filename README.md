# iAstro 🪐

Vedic astrology, computed properly. Free. No ads. No data sale. Conversations
deleted after 7 days.

By [Harieshwar Jagan Abirami](https://github.com/HariEshwar-J-A)

Vedic astrology backend and mobile app, built on an ephemeris verified against
JPL Horizons and a corpus that cites Brihat Parashara Hora Shastra by chapter
and verse.

The premise is that the computation is the hard part, not the prose. Planetary
positions come from [`node-jhora`](https://github.com/HariEshwar-J-A/node-jhora),
which reproduces Jagannatha Hora's conventions to sub-arcsecond agreement.
Classical rules come from [`JyotishBase`](https://github.com/HariEshwar-J-A/JyotishBase).
The language model presents computed facts — it does not invent them.

> **Note:** iAstro was previously HoraMind, an OpenClaw-based Telegram agent.
> It is now a standalone HTTP backend with a React PWA. The interpretation rules in
> `agent_config/prediction-method.md` carried over unchanged; the OpenClaw
> runtime, the Telegram transport and the file-based user store did not.

---

## Layout

```
apps/api/          Fastify backend (TypeScript, ESM)
apps/mobile/       Expo / React Native app          (Epic 7)
packages/shared/   Zod schemas shared by API and client
db/migrations/     Plain SQL, applied in filename order
infra/docker/      Dockerfile, Compose, Caddy
infra/k8s/         Kubernetes manifests             (Epic 8)
agent_config/      Interpretation rules for the AI layer
```

`packages/shared` holds every request and response contract as a Zod schema.
The server validates against it, the client derives its types from it, and the
OpenAPI document is generated from it — so a rule cannot drift between the two
ends of a request.

---

## Running it

### With Docker (recommended)

```bash
cp .env.example .env
```

Fill in `POSTGRES_PASSWORD` and `JWT_SECRET` — the API refuses to start without
them, deliberately. Generate a secret with:

```bash
openssl rand -base64 48
```

Then:

```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

That brings up Postgres, ChromaDB, a one-shot migration job, and the API. The
API waits for migrations to finish, so a container can never serve against a
schema older than its code.

### Without Docker

Requires Node 22+ and a reachable PostgreSQL 16.

```bash
npm install
npm run build
npm run db:migrate
npm run dev
```

---

## Commands

```bash
npm run build       # compile every workspace
npm run typecheck   # tsc -b across project references
npm run lint        # eslint
npm test            # vitest
npm run db:migrate  # apply pending migrations
npm run db:status   # list applied and pending, change nothing
```

---

## Health

| Route | Meaning |
|---|---|
| `GET /health` | Liveness. Touches nothing. A database blip must not restart a healthy process |
| `GET /ready` | Readiness. Verifies Postgres and the ephemeris engine |
| `GET /docs` | Swagger UI, non-production only |

---

## Migrations

Plain `.sql` files applied in filename order, each in a transaction, each
recorded with a checksum. Editing a migration that has already run is refused —
that is the fastest way to end up with two environments whose schemas differ
while both report being up to date. Write a new file instead.

---

## Privacy

Chats are retained for 7 days and then permanently deleted by `run_retention()`,
a database function rather than application code. Retrieval calls are logged as
a query *hash* plus the verses returned, never the text the user typed. Only
what a user deliberately saves as a Memory is kept.

The claim the app makes is that conversations are never used for advertising or
profiling, never sold, and deleted after 7 days — not that nothing is stored.
That would be false, and both app stores require the declaration to be accurate.

---

## Licence

PolyForm Noncommercial 1.0.0. Commercial terms in
[COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md).
