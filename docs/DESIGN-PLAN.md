# iAstro — engineering and design plan

Everything known about this codebase that is not obvious from reading it, plus
everything still to build. Written to be picked up cold by someone who was not
present for the work that produced it.

Two kinds of content, deliberately mixed: **what is already true and cost
something to learn** (Parts 1–5), and **what is still to do** (Parts 6–10). The
first half exists because most of these facts were discovered by hitting them,
and rediscovering them is the expensive way.

Branch: `feat/vedic-ui-and-fixes`.

---

# Part 0 — Current state

## Built and pushed

| Area | State |
|---|---|
| API | Fastify, all routes working, including `/v1/charts/now` and notifications |
| Web | React/Vite PWA, rebranded iAstro |
| Charts | North + South Indian, toggle, nakshatra dial, rendered planet bodies |
| Calendar | ±7 days, deterministic, no model calls |
| Life analysis | 5 sections, screened, hash-based staleness |
| Guard rails | Input + output screening, per-route rate limits, hollow-200 retry |
| Edit details | Full edit with cache invalidation |
| `packages/ui` | Antara — layout, controls, feedback, scrollbar, overflow, shadcn tokens |
| Landing | Live `ChartWheel` hero at `/` when signed out |
| Notifications | Schema, API, detector, bell, prefs, quiet hours |
| Run tooling | `driver.mjs` (23 assertions), `audit.mjs` (15 screens × 2 widths) |

## Not built

shadcn *components* (tokens are mapped; Antara covers the inventory) ·
email channel for notifications · full locale packs beyond `t()` + `en`.

---

# Part 1 — Landmines already hit, and why they recur

Each of these was a real bug that shipped or nearly shipped. They are recorded
because every one of them **looked fine** until something specific was checked.

## 1.1 `z.coerce.boolean()` is `Boolean(string)`

`DATABASE_SSL=false` became `true`. Every non-empty string is truthy, including
the literal `"false"` that `.env.example` documents and every deployment copies.

- Symptom: `/ready` reported `"database": false` with no error anywhere, because
  `pingDb` swallows in a bare `catch`.
- The `TRUST_PROXY` half failed *silently* — every client IP read as the proxy's,
  collapsing all users into one rate-limit bucket.
- Fixed with `envBoolean()` in `config/env.ts`, which **rejects** unrecognised
  spellings rather than defaulting. `DATABASE_SSL=ture` now fails at boot.
- **Rule: never use `z.coerce.boolean()` on anything from the environment.**

## 1.2 Postgres `date` columns come back as `Date` at UTC midnight

`postgres.js` parses `1990-08-15` via `new Date(...)`, which JS reads as UTC
midnight. `String()` on that gives `"Tue Aug 14 1990 20:00:00 GMT-0400"` — wrong
format *and*, west of Greenwich, **the wrong day**.

- Broke `POST /v1/profiles` (500 on response serialisation) and
  `GET /v1/charts/natal` (`String(date).slice(0,10)` → `"Tue Aug 1"`).
- Fixed with `toCalendarDate()` in `repos/profiles.ts`, used by both consumers.
- `ProfileRow.birthDate` is typed `string | Date` — it was declared `string`,
  which was untrue and is exactly why the conversion was never tested.
- **Rule: never build a `Date` from a `YYYY-MM-DD` string to read its parts.**
  `Calendar.tsx` derives the weekday arithmetically for this reason.

## 1.3 `String()` on an object gives `"[object Object]"` — into a prompt

`computeBasis` stringified the panchanga limbs, which arrive as
`{ index, name, percent }`. The result was `"[object Object]"` for tithi,
nakshatra, yoga, karana and vara.

- **This was not a display bug.** The basis is serialised directly into the
  model's prompt, so every daily reading was generated with five of its inputs
  blanked — and the prose came back just as confident.
- Fixing it exposed a second bug hiding behind it: `panchanga()` was being
  handed `contextFor(profile)`, the **birth** moment, so the compass described
  the day the user was born and labelled it today. Invisible while everything
  was `[object Object]`.
- **Rule: a value that flows into a prompt is load-bearing. Type it.**

## 1.4 `profile: null` conflated "no profile" with "not asked yet"

`restore()` set `status: 'authenticated'` one line before the profile arrived. In
that gap the route guard read `requiresProfile && !profile`, redirected to
`/onboarding` with `replace`, and nothing sent the user back — so **every
reload** stranded an onboarded account on the onboarding form, with no history
entry to return to.

- Fixed by resolving the profile *before* announcing the session.
- The auth half of this race was already guarded by an explicit `'unknown'`
  status; the profile half never got the same treatment.
- **Rule: a nullable field used by a guard needs a third state for "unknown".**

## 1.5 `AnimatePresence` + a declarative redirect = infinite loop

`AnimatePresence` keeps the *outgoing* subtree mounted during exit, so a second
stale `<Routes>` stays live; its `Guard` re-renders `<Navigate>`, and the two
trees push each other until React reports **"Maximum update depth exceeded"**.

- Any route tree containing a declarative redirect has this problem.
- Fixed by dropping exit animations and keying a wrapper on `location.pathname`:
  one live tree, one redirect, entrance animation intact.
- **Rule: do not wrap `<Routes>` in `AnimatePresence` when guards redirect.**

## 1.6 Inscribed rectangles are not centroids

The North Indian chart overflowed **three times** before it was right.

- The twelve houses are three shapes: four rhombi, four wide triangles, four
  tall ones. Laying out from a centroid with fixed offsets fits the rhombi and
  pushes glyphs through the walls of the rest.
- Then boxes were declared per house — but the triangle boxes were still wrong.
  House 12's base is 50 wide narrowing to an apex at (75,25); at depth `y` the
  half-width is `25−y`, so a box of height `h` can only be `2(25−h)` wide. It had
  28 × 13 where the shape allows **25 × 12.5**.
- Third cause: the two-letter code hangs right of the body, but cells were
  centred on the **body**, so every code sat ~3r right of where it belonged.
- Also: stacking the code *below* each body makes a graha ~5r tall, which forced
  four planets in a narrow house down to r≈1.1. The code sits **right** of the
  body now, halving cell height.
- **Rule: for any polygon that is not a rectangle, compute the largest inscribed
  rectangle and lay out inside it. Never offset from a centroid.**

## 1.7 A signal that never varies is noise

The calendar's per-day mark read Saturn's house from the Moon. Saturn moves so
slowly that **all fifteen days carried an identical mark**. Correct, and useless.

- Replaced with the tithi's classical five-fold class (rikta / purna / other),
  which turns over daily and is a real judgement about a day.
- **Rule: before shipping a per-item indicator, check it differs across items.**

## 1.8 Flex children will not shrink below their content

`min-width: auto` is the default, which is why truncation inside a flex row
silently does nothing and **the row overflows instead**. Handled once in
`antara.css` (`.antara-row > * { min-width: 0 }`) and in the `Clamp` component.

## 1.9 `overflow: hidden` creates a scroll container

Which silently breaks `position: sticky` in any descendant, and is miserable to
trace back to the ancestor that caused it. `Panel` uses `overflow: clip`.

---

# Part 2 — Environment: running this thing

## 2.1 Ports

**Postgres runs on 55432, not 5432.** Port 5432 on the development machine
belongs to another project's container (`infosentry-db`), as does 8000
(`infosentry-chroma`). `.env` points Chroma at **8001** so a misconfigured
iAstro cannot talk to the other project's vector store.

## 2.2 `LC_ALL=C` is mandatory on macOS

Without it Postgres dies with `postmaster became multithreaded during startup` —
libc's locale lookup spawns threads and Postgres refuses to fork a multithreaded
postmaster. Nothing in the message mentions locales. `dev-local.sh` exports it.

## 2.3 Docker does not work on this machine

containerd fails with `failed to create new OS thread (errno=11)`. That is why
Postgres runs natively via `infra/scripts/dev-local.sh`.

Separately, and independent of that machine: **the README's Docker command is
wrong.** `docker compose -f infra/docker/docker-compose.yml up` never reads the
root `.env`, because Compose resolves `.env` against the *compose file's*
directory. It dies on `JWT_SECRET is required`. Use `--env-file .env`.

## 2.4 Nothing loads `.env` automatically

No `dotenv`, no `--env-file` in any script. Every command sources it explicitly:

```bash
set -a && . ./.env && set +a && npm run dev
```

## 2.5 `apps/web` is not in the root `tsconfig` references

So `npm run typecheck` **does not cover the web client** — only `vite build`
does. It let four type errors through once. Fixing it needs `composite: true` on
that project, which changes build output, so it was left alone mid-branch.

## 2.6 Running it

```bash
./infra/scripts/dev-local.sh start      # Postgres + migrations
set -a && . ./.env && set +a && npm run dev          # API  :8080
npm run dev --workspace @horamind/web                # web  :5173
```

---

# Part 3 — Model and AI operations

## 3.1 The shipped default model does not exist

`OPENROUTER_MODEL_FREE=meta-llama/llama-3.3-70b-instruct:free` — retired.
OpenRouter rejects it and names the paid slug. **Still wrong in `env.ts` and
`.env.example`**; a fresh clone hits this immediately.

## 3.2 A provider that returns HTTP 200 with nothing in it

`meta-llama/llama-3.3-70b-instruct` returns a **hollow 200** — null content, no
`tool_calls`, no `usage`, `finish_reason: null` — whenever OpenRouter routes it
to **DeepInfra**. The identical request succeeds on AkashML.

| Model | Provider | Result |
|---|---|---|
| llama-3.3-70b-instruct | DeepInfra | **empty** |
| llama-3.3-70b-instruct | AkashML | ok, 2.9s |
| gpt-4o-mini | OpenAI | ok, 5.1s |
| gemini-2.5-flash | Google | ok, **0.8s** |

Pinned to `google/gemini-2.5-flash` because it is **single-provider** — no
routing roulette. A multi-provider model will hit DeepInfra again at random.

**Outstanding:** `openrouter.ts` treats a hollow 200 as a hard 502. It has
deliberate handling for 429 and 402; retrying once on a different provider would
be a real robustness win.

## 3.3 Cost shape

- `/v1/interpret` — 1–3 completions, rate limited 10/min.
- `/v1/compass` — 1 completion, cached per day, 20/min.
- `/v1/life-analysis` — **5 completions**, rate limited 1/min, stored.
- `/v1/calendar` — **zero**. Deliberate: 15 days of prose is 15 paid completions
  for a screen most people scroll past.

## 3.4 Guard rails as built

- `screenQuestion` runs **before quota is consumed** — an injection attempt
  should not also cost a question. Matches on the *shape* of an instruction, not
  a vocabulary list.
- `screenAnswer` runs on output. An empty answer counts as a failure.
- Life analysis sections are **dropped, not softened**, when they fail.
- Tests are weighted toward what must **not** be blocked — a screen that rejects
  everything is trivially safe and useless, and it fails quietly.

**Outstanding:** no integration test asserts a refused answer reaches the client
as the refusal. Verified by hand only.

---

# Part 4 — Licensing and supply chain

## 4.1 Beautiful UI

**MIT, © 2026 Shane Levine** (Turbo). `packages/... /bui/NOTICE.md` carries the
licence and lists every modification.

Source is **not** at `/components` or `/docs` — both 404. It is in the RSC flight
payload embedded in the page HTML, as text chunks marked `<id>:T<hexLength>,`.

**That length is in bytes, not characters.** The files contain U+2500 box-drawing
rules (3 bytes each), so character-based slicing over-reads and staples the head
of the next chunk onto every file — producing 19 files each with a syntax error
on the *last* line and nothing wrong above it.

## 4.2 `glimm` was removed

Declares **no source repository** — unauditable — and compiles and runs WebGL
shaders. Its entire contribution was a decorative sweep. `ChatComposer` and
`PromptBar` went with it. `liveline` stays: MIT, public repo, 163k weekly
downloads, draws real data.

## 4.3 Vulnerabilities

`react-router-dom` 6.30.4 → 7.18.2 cleared three advisories including an
**open redirect → XSS** ([GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2)),
which mattered because this app redirects on every guarded route.

**7 findings remain**, all pre-existing, all in the API's
`@xenova/transformers` → `onnx`/`sharp` tree. `npm audit fix --force` "fixes"
them by downgrading the embedding model RAG depends on. Left deliberately.

## 4.4 Vetted alternatives

| Library | Licence | Stars | Verdict |
|---|---|---|---|
| shadcn/ui | MIT | 121k | **Chosen** — see §7.1 |
| assistant-ui | MIT | 11.6k | Best AI-chat option if needed |
| prompt-kit | MIT | 3k | Good; 5 months stale |
| Vercel AI SDK | Apache-2.0 | 26k | Permissive, patent grant |

---

# Part 5 — How to verify (this is the important part)

Three UI defects shipped while **every automated assertion passed**: a clipped
day strip, identical day marks, and overflowing chart glyphs. Two of them
survived a screenshot review as well.

## 5.1 The tooling

```bash
node .claude/skills/run-horamind/driver.mjs all      # 23 assertions
node .claude/skills/run-horamind/audit.mjs /tmp/a 390 844 9470   # phone
node .claude/skills/run-horamind/audit.mjs /tmp/b 1280 900 9471  # desktop
```

The driver asserts **invariants, not status codes**: Rahu and Ketu exactly
opposed (proves the ephemeris is consulted, not stubbed), `birthDate` still
`YYYY-MM-DD` after a round trip, the session surviving a reload.

## 5.2 Lessons that cost something

- **`innerText` returns text from `opacity: 0` elements.** Waiting on text to
  appear is satisfied *before a single frame of animation runs*, so screenshots
  land mid-reveal and look like rendering bugs. Wait on **computed opacity**.
- **`location.pathname` is not a readiness signal.** It updates before React
  decides what to render; during session restore the guard shows a splash with
  no tab bar. Wait for the **element**.
- **Geometry must be checked geometrically.** For anything laid out in SVG, walk
  the elements, take `getBBox()`, and assert containment. Screenshot review
  passed the broken chart twice; the bbox check found it in one run.
- **CDP: `returnByValue` cannot serialise a DOM node** — `querySelector` fails
  with "Object reference chain is too long". Wrap waits in `Boolean(...)`.
- **CDP: re-inject helpers on every document** via
  `Page.addScriptToEvaluateOnNewDocument`; a reload discards the JS context.
- **Setting `.value` on a React input does nothing.** React tracks its own value;
  use the native prototype setter plus a bubbling `input` event.

---

# Part 6 — Rebrand to iAstro

- `apps/web/index.html` — `<title>`, `<meta name="description">`.
- `apps/web/vite.config.ts` — PWA manifest `name`, `short_name`, `description`.
- `apps/api/src/server.ts` — OpenAPI `info.title`.
- `packages/shared` — user-facing strings.
- **`JWT_ISSUER` / `JWT_AUDIENCE` are not cosmetic.** Changing them invalidates
  every issued token. Either leave them as `horamind` or ship with a forced
  re-login and say so in the release note.
- npm package names (`@horamind/*`) can stay — renaming touches every import for
  no user-visible gain.

**On the tagline:** do not put "the only free astrology app" in store metadata.
App stores reject unsubstantiable superlatives and it is trivially falsifiable.
**"Free. No ads. No data sale. Conversations deleted after 7 days."** is
defensible from the README and says more.

---

# Part 7 — Component library

## 7.1 shadcn, not MUI

The brief said one or the other, never both. shadcn, for reasons specific to
this repo rather than general preference:

- **Copy-paste, not a runtime dependency** — the property that made Beautiful UI
  safe to vendor. Code you own cannot be relicensed or yanked.
- MUI ships its own theming engine (Emotion) and token vocabulary. This app
  already has two token layers — `theme/tokens.ts` (React-Native-safe objects)
  and `beautiful-ui.css` (semantic CSS variables). A third makes "where is this
  colour defined" unanswerable.
- **MUI conveys elevation through shadow, and shadow is invisible on this
  palette.** Every card would flatten into the page.

shadcn lands in `packages/ui/src/shadcn/`, re-themed the way Beautiful UI was —
by pointing its variables (`--background`, `--foreground`, `--border`, `--ring`)
at Antara's, never by editing components.

## 7.2 The 14 unmounted Beautiful UI components

| Component | Where it belongs |
|---|---|
| `ThinkingState` | Ask, while the model runs |
| `StreamingText` | Ask and Life — replaces the local `ai.tsx` version |
| `ApprovalCard` | Life — confirm before spending 5 completions |
| `TaskRows` | Life — one row per section while generating |
| `ToolChips` | Ask — show the classical-text search ran, and on what |
| `ContextCards` | Ask — the dasha stack the answer rests on |
| `RecordsTable` | Chart — the planet table |
| `FilterTable` | Calendar — filter days by mark |
| `DiffTable` | Edit details — show what changes before saving |
| `InsightCards` | Today — dos and don'ts |
| `RecommendationCard` | Today — the headline |
| `SidebarNav` | Desktop layout (§7.3) |
| `SearchList` | Place search in Edit details |
| `CodeBlock` | Debug view of the raw basis |
| `SelectionActions` | Memories — bulk delete |

Use `ThinkingState` for model work and `LoadingState` for computation —
consistently. Two loaders meaning the same thing is worse than one.

## 7.3 Layout primitives — build these first

Components sized in a vacuum get resized the first time they meet a real page.

- `Stack` — vertical rhythm from the 4-point scale. `gap`, `align`.
- `Row` — horizontal, `min-width: 0` on children by default (§1.8).
- `Grid` — `repeat(auto-fit, minmax(N, 1fr))`; needs no breakpoints.
- `Shell` — **responsive at last.** Tab bar under ~900px, `SidebarNav` above.
  The app is currently a 720px mobile column, which on a desktop reads as a
  phone screenshot rather than an app.
- `Section` — titled region with an optional corner action. The repeated unit on
  every screen, and it does not exist.

## 7.4 Component inventory

Each needs **props, states, motion, a11y, and the overflow case**. The overflow
case is listed because it is the one that gets skipped, and skipping it produced
§1.6.

| Component | Detail |
|---|---|
| `Button` | primary/secondary/ghost/danger. idle/hover/active/disabled/**loading** (spinner replaces label, width locked to prevent reflow). 44px min. Label truncates, never wraps. |
| `IconButton` | 44px target even at a 20px glyph — pad, do not shrink. `aria-label` required by types. |
| `Field` | label/hint/error/prefix/suffix. `aria-describedby` + `aria-invalid`. **16px font minimum or iOS zooms on focus.** |
| `Select` | Native `<select>` on mobile — the OS picker is better and already localised. Custom listbox only above 900px. |
| `DateField` | Never `new Date(string)` — see §1.2. |
| `Sheet` | Bottom sheet mobile, dialog desktop. Focus trap, `Esc`, focus returned to trigger, body scroll locked. Spring in, no bounce out. |
| `Tabs` | The `layoutId` indicator proven in `Segmented`. Roving tabindex. |
| `Accordion` | Height via Motion layout, never a `max-height` guess. |
| `Tooltip` | Touch has no hover — long-press, and never the only route to information. |
| `Table` | Horizontal scroll **inside its own container** with a sticky first column. Never page-level scroll. |
| `Skeleton` | Shaped like the content it replaces so nothing jumps. Proven on Chart. |
| `Badge` | Never colour-only — pair with a shape or a word. |
| `Avatar` | Initials fallback, deterministic colour from `publicId`. |
| `Progress` | `role="progressbar"` with values set. |
| `Toast` | **Built.** Needs a queue — a second toast currently replaces the first. |
| `Empty` | **Built.** |
| `ErrorState` | **Not built.** What failed, whether retrying helps, and a retry that refetches. |

## 7.5 Motion rules

Inconsistent motion reads as brokenness, not style.

- Enter 320ms, exit 180ms. Exit always faster; matching them feels sticky.
- **Springs** for position, **durations** for opacity.
- One orchestrated reveal per screen, staggered 55ms. Not per component.
- `prefers-reduced-motion` in **every** component. Reduced motion means content
  arrives *already in place*, never that it fails to arrive.
- Never animate `width`/`height`/`top`/`left`. Transform and opacity only.
- SVG: `transformOrigin` on a `<g>` is measured in **CSS pixels of the rendered
  box**, not diagram user units — which is why the Moon marker never left twelve
  o'clock. Use trigonometry to place, not rotation to move.

## 7.6 Corner-case checklist — every component, before "done"

1. Longest plausible string — 40-char German compound, untruncated email, URL.
2. Empty string, and `null`.
3. One item; zero items; 200 items.
4. 320px viewport (iPhone SE is still in use).
5. 200% browser zoom.
6. `prefers-reduced-motion: reduce`.
7. Keyboard only — reachable, visibly focused, operable.
8. Slow network — what shows for the three seconds before data.
9. Failed request — what shows, and can it be retried without a reload.

---

# Part 8 — Landing page

Route `/` when signed out. Currently `/` redirects to `/sign-in`, which is why
there is nowhere to put this. Change `Guard` so an unauthenticated `/` renders
`Landing`; keep `/sign-in` for direct arrivals.

1. **Hero** — the live `ChartWheel` drawing itself for *the visitor's current
   moment and location*, not a static image. The strongest thing the product can
   show: the diagram is real and being computed while they watch. Needs an
   unauthenticated `GET /v1/charts/now` (lat/long/time, no profile, no
   persistence, IP rate-limited).
2. **The claim** — free, no ads, conversations deleted after 7 days. All three
   backed by the README.
3. **Three differentiators**, each with a live artefact rather than a
   screenshot: the ephemeris verified against JPL Horizons; the corpus citing
   Parashara by chapter and verse; the model that presents computed facts.
   Third last — it needs the first two to be believed.
4. **A worked example** — one real question with its dasha stack and citations.
   Static, so it is free to serve and identical for everyone.
5. **Privacy, plainly** — reuse the README's wording, which is already honest
   about what *is* stored.
6. **One call to action**, top and bottom. No newsletter. No cookie banner (§10).

## Internationalisation — "easy to understand for anyone in the world"

- Every string through `t()` from day one, even with one locale. Retrofitting
  i18n is the expensive version of this.
- No text baked into SVG artwork.
- The chart is the demo, and it is language-neutral. Lean on that.
- `Intl.NumberFormat` for degrees and dates — the app's whole substance.
- **RTL: the North Indian chart must not mirror** under `dir="rtl"`. Its geometry
  is conventional, not directional. Set `direction: ltr` on the SVG.
- Planet codes (Su, Mo, Ma…) are English abbreviations. For non-Latin locales
  either localise them or fall back to the rendered body alone — the bodies are
  already distinguishable by colour and form.

---

# Part 9 — Notifications

Build the service first; the UI is small once it exists.

## 9.1 Schema

```sql
-- 0005_notifications.sql
CREATE TYPE notification_kind AS ENUM
    ('daily_compass', 'dasha_change', 'transit', 'life_stale', 'system');

CREATE TABLE notification_prefs (
    user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- Per-kind opt-in, defaulting OFF for everything but system.
    -- Defaulting to on is how an app becomes something people mute.
    kinds       jsonb NOT NULL DEFAULT '{}',
    -- Quiet hours as minutes from midnight, in the user's own zone.
    quiet_from  smallint,
    quiet_to    smallint,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        notification_kind NOT NULL,
    title       text NOT NULL,
    body        text NOT NULL,
    href        text,                        -- deep link, e.g. /chart
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX notifications_unread ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE TABLE push_subscriptions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    text NOT NULL,
    p256dh      text NOT NULL,
    auth        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (endpoint)
);
```

Add `purge_expired_notifications()` to `run_retention()`. Retention here is a
database function, not app code — a new table that forgets that becomes the one
thing never cleaned. **Note:** `updated_at` is set by the writing statement; no
table in this schema uses a trigger, and introducing the first would mean two
conventions for one column.

## 9.2 What is worth sending

The bar: it must tell someone something **they could not have known without
it**. "Your daily compass is ready" fails — the app is right there.

- `dasha_change` — a maha/antar/pratyantar boundary crossed. Date-driven,
  invisible without computation, and the most defensible notification here.
- `transit` — Saturn or Jupiter changing sign; Sade Sati starting or ending.
- `life_stale` — `inputs_hash` no longer matches and it has been > N days.
  Reuses machinery that already exists.
- `daily_compass` — **off by default.** Offer it; do not assume it.

Detection runs in a scheduled job: compute today's dasha stack per profile,
compare with the last stored one, emit on difference. Store the last-seen stack
so the comparison is a lookup, not a recomputation of yesterday.

## 9.3 API

```
GET    /v1/notifications?unread=true
POST   /v1/notifications/:id/read
POST   /v1/notifications/read-all
GET    /v1/notification-prefs
PATCH  /v1/notification-prefs
POST   /v1/push/subscribe
DELETE /v1/push/subscribe
```

Web Push needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and the
`web-push` package. The service worker already exists via `vite-plugin-pwa` —
extend it with a `push` handler rather than adding a second worker.

**Quiet hours are enforced server-side at send time**, in the user's timezone.
Client-side suppression means the phone still buzzes at 3am.

## 9.4 UI

- Bell in the header with an unread count, `aria-live="polite"`.
- A `Sheet` listing notifications grouped by day, unread first.
- Settings in **Me**: a toggle per kind plus quiet hours. Label each with what
  it sends *and roughly how often* — "Dasha changes · a few times a year" tells
  someone whether to enable it; "Dasha changes" does not.
- Permission requested **when the first push toggle is turned on**, never on
  load. A prompt before the value is understood is how an app gets permanently
  denied.

---

# Part 10 — Migration order and loose ends

## 10.1 Screen migration

Do not rewrite in one pass. Per screen: layout to `Shell` + `Section`, swap
primitives for Antara, mount the mapped Beautiful UI component, re-run the audit
at both widths.

Least to most risk: `Devices` → `Me` → `Calendar` → `Today` → `Ask` → `Life` →
`Chart`. **Chart last** — most bespoke, least likely to benefit.

## 10.2 Loose ends

- **`public/icon-192.png` and `icon-512.png` do not exist.** Until they do,
  Android refuses "Add to home screen" — the entire point of a PWA. The 512
  needs a maskable safe zone: artwork inside the central 80%.
- **No cookie banner is needed.** The only cookie is the httpOnly refresh token,
  strictly necessary for authentication and therefore exempt. Adding one would
  be a self-inflicted wound.
- **Offline.** The PWA precaches the shell but every screen needs the network.
  At minimum cache the last natal chart — it is immutable, so it is the safest
  possible thing to serve stale.
- **`OPENROUTER_MODEL_FREE` default is still dead in the repo** (§3.1).
- **Hollow-200 retry** (§3.2).
- **Refusal integration test** (§3.4).
- **`apps/web` missing from root tsconfig** (§2.5).
- **`.gitignore`** was narrowed to `.claude/*` + `!.claude/skills/` so the run
  skill is committable. A bare `!.claude/skills/` would not work — git does not
  descend into an excluded directory.
