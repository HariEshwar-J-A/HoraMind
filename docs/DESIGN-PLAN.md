# iAstro — build plan

Everything still outstanding, in the order it should be built, with enough
detail to start from cold. Written to be picked up by someone who was not in the
conversation that produced it.

Current state: `packages/ui` ("Antara") exists with six components and the
scrollbar. `apps/web` still renders almost everything through the older
`components/primitives.tsx`. The plan below is mostly about closing that gap.

---

## 0. Decisions already made, so they are not re-litigated

**shadcn, not MUI.** The brief said one or the other, never both. shadcn wins
here for three reasons that are specific to this repo rather than general
preference:

- It is **copy-paste, not a runtime dependency** — the same property that made
  Beautiful UI safe to vendor. Code you own cannot be relicensed or yanked.
- MUI ships its own theming engine (Emotion) and its own token vocabulary. This
  app already has two token layers — `theme/tokens.ts` for the React-Native-safe
  objects and `beautiful-ui.css` for the semantic CSS variables. A third would
  make "where is this colour defined" unanswerable.
- MUI components are dense with Material's own motion and elevation opinions,
  which are the *opposite* of the instrument language: Material uses shadow for
  elevation, and shadow is invisible on this palette.

shadcn components land in `packages/ui/src/shadcn/` and are re-themed the same
way Beautiful UI was — by pointing their CSS variables at Antara's, not by
editing them. shadcn already uses `--background`, `--foreground`, `--border`,
`--ring`; map those to the existing tokens in `antara.css` and every shadcn
component inherits the night sky for free.

**Beautiful UI is under-used.** Fourteen of the nineteen vendored components are
not mounted anywhere. The mapping to build against:

| Component | Where it belongs |
|---|---|
| `ThinkingState` | Ask, while the model runs — replaces `LoadingState` there |
| `StreamingText` | Ask and Life, replacing the local `ai.tsx` version |
| `ApprovalCard` | Life — confirm before spending five completions on a rewrite |
| `TaskRows` | Life — one row per section while it generates |
| `ToolChips` | Ask — show that the classical-text search ran, and on what |
| `ContextCards` | Ask — the dasha stack that the answer rests on |
| `RecordsTable` | Chart — the planet table |
| `FilterTable` | Calendar — filter days by mark |
| `DiffTable` | Edit details — show what is about to change before saving |
| `InsightCards` | Today — the dos and don'ts |
| `RecommendationCard` | Today — the headline |
| `SidebarNav` | Desktop layout (see §4) |
| `SearchList` | Place search in Edit details |
| `CodeBlock` | Developer/debug view of the raw basis |
| `SelectionActions` | Memories — bulk delete |

**Never both** also applies to loaders: pick `ThinkingState` for model work and
`LoadingState` for computation, and use them consistently.

---

## 1. Rebrand to iAstro

"iAstro — the only free astrology app."

- `apps/web/index.html` — `<title>`, `<meta name="description">`.
- `apps/web/vite.config.ts` — PWA manifest `name`, `short_name`, `description`.
- `packages/shared` — any user-facing string carrying "HoraMind".
- `apps/api/src/server.ts` — the OpenAPI `info.title`.
- `.env.example` — `JWT_ISSUER` / `JWT_AUDIENCE` are **not** cosmetic. Changing
  them invalidates every issued token, so either leave them as `horamind` or
  ship the change with a forced re-login and say so in the release note.
- The npm package names (`@horamind/*`) can stay. Renaming them touches every
  import for no user-visible gain; do it only if the repo itself is renamed.

**Do not** claim "the only free astrology app" in store metadata without
checking it — app stores reject superlatives that are not substantiable, and it
is trivially falsifiable. "Free, with no ads and no data sale" is defensible and
says more.

---

## 2. Marketing landing page

Route `/` when signed out. Currently `/` redirects straight to `/sign-in`, which
is why there is nowhere to put this. Change `Guard` so an unauthenticated visit
to `/` renders `Landing` instead of redirecting; keep `/sign-in` as its own
route for people who arrive there directly.

### Structure

1. **Hero.** The live `ChartWheel` drawing itself, computed for *the current
   moment at the visitor's location* — not a static image. This is the single
   strongest thing the product can show: the diagram is real, and it is being
   computed while they watch. Needs an unauthenticated `GET /v1/charts/now`
   returning a chart for a supplied lat/long/time with no profile and no
   persistence, rate-limited by IP.
2. **The claim.** "Free. No ads. Your conversations are deleted after seven
   days." Three statements the README can already back.
3. **How it is different.** Three panels, each with a live artefact rather than
   a screenshot: the ephemeris verified against JPL Horizons; the corpus that
   cites Parashara by chapter and verse; the model that presents computed facts
   and does not invent them. The third is the differentiator and should be last,
   because it is the one that needs the first two to be believed.
4. **A worked example.** One real question and its answer, with the dasha stack
   and citations visible. Static content — not a live model call — so it is
   free to serve and identical for everyone.
5. **Privacy, stated plainly.** Reuse the README's wording, which is already
   honest about what *is* stored.
6. **One call to action**, repeated at top and bottom. No newsletter, no cookie
   banner (there is nothing to consent to — see §6).

### Internationalisation, since "anyone in the world"

- Every string through a `t()` from day one, even with one locale. Retrofitting
  i18n is the expensive version of this.
- No text baked into SVG artwork.
- The chart is the demo, and it is language-neutral — lean on that.
- Numerals: use `Intl.NumberFormat`; degrees and dates are the app's whole
  substance and they format differently by locale.
- RTL: the North Indian chart must **not** mirror under `dir="rtl"` — its
  geometry is conventional, not directional. Set `direction: ltr` on the SVG.

---

## 3. Notifications

Two halves. Build the service first; the UI is small once it exists.

### 3.1 Data

```sql
-- 0005_notifications.sql
CREATE TYPE notification_kind AS ENUM
    ('daily_compass', 'dasha_change', 'transit', 'life_stale', 'system');
CREATE TYPE notification_channel AS ENUM ('in_app', 'push', 'email');

CREATE TABLE notification_prefs (
    user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    -- Per-kind opt-in, defaulting OFF for everything except system.
    -- Defaulting to on is how an app becomes something people mute.
    kinds       jsonb NOT NULL DEFAULT '{}',
    -- Local quiet hours, stored as minutes from midnight in the user's zone.
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
    -- Deep link, e.g. /chart or /you/life.
    href        text,
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Same retention discipline as chats.
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

Add `purge_expired_notifications()` to `run_retention()` in the same style as
the existing purges — retention is a database function here, not app code, and
a new table that forgets that becomes the one thing that never gets cleaned.

### 3.2 Triggers, and what makes them worth sending

The bar: a notification must tell someone something **they could not have known
without it**. "Your daily compass is ready" fails that — the app is right there.

- `dasha_change` — a mahadasha, antardasha or pratyantardasha boundary crossed.
  This is genuinely date-driven, invisible without computation, and the single
  most defensible notification the product has.
- `transit` — Saturn or Jupiter changing sign, or Sade Sati starting or ending.
  Rare, slow, consequential.
- `life_stale` — the life reading's `inputs_hash` no longer matches, and it has
  been more than N days. Reuses machinery that already exists.
- `daily_compass` — **off by default**. Offer it, do not assume it.

Detection runs in a scheduled job, not on request: compute today's dasha stack
per profile, compare against the last one stored, emit on difference. Store the
last-seen stack per profile so the comparison is a lookup rather than a
recomputation of yesterday.

### 3.3 API

```
GET    /v1/notifications?unread=true    list, paginated
POST   /v1/notifications/:id/read       mark one
POST   /v1/notifications/read-all       mark all
GET    /v1/notification-prefs           current settings
PATCH  /v1/notification-prefs           update
POST   /v1/push/subscribe               store a Web Push subscription
DELETE /v1/push/subscribe               remove one
```

Web Push needs a VAPID keypair in `.env` (`VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) and the `web-push` package. The service
worker already exists via `vite-plugin-pwa`; extend it with a `push` handler
rather than adding a second worker.

**Quiet hours are enforced server-side**, at send time, in the user's timezone.
Client-side suppression means the phone still buzzes at 3am and the app merely
declines to show it.

### 3.4 UI

- A bell in the header with an unread count. `aria-live="polite"` on the count.
- A sheet listing notifications, grouped by day, unread first.
- Settings in **Me**: one toggle per kind, plus quiet hours. Each toggle is
  labelled with what it will actually send and roughly how often — "Dasha
  changes · a few times a year" tells someone whether to enable it; "Dasha
  changes" does not.
- Permission is requested **when the first push-requiring toggle is turned on**,
  never on load. A permission prompt before the value is understood is how an
  app gets permanently denied.

---

## 4. The component library

Build order matters: layout before components, because components sized in a
vacuum get resized the first time they meet a real page.

### 4.1 Layout primitives (build first)

- `Stack` — vertical rhythm from the 4-point scale. Props: `gap`, `align`.
- `Row` — horizontal, with `min-width: 0` applied to children by default
  (see `antara.css`; this is the fix nobody guesses).
- `Grid` — `repeat(auto-fit, minmax(N, 1fr))`, so it needs no breakpoints.
- `Shell` — the page frame. **Responsive at last**: tab bar under ~900px,
  `SidebarNav` above it. The app is currently mobile-only in a 720px column,
  and on a desktop that reads as a phone screenshot rather than an app.
- `Section` — a titled region with an optional action in the corner. This is the
  repeated unit on every screen and it does not exist yet.

### 4.2 Components, with the details that matter

For each: **props, states, motion, a11y, and the overflow case.** The overflow
case is listed because it is the one that gets skipped and it is the one that
produced the bug that started this document.

| Component | Notes |
|---|---|
| `Button` | Variants: primary, secondary, ghost, danger. States: idle, hover, active, disabled, **loading** (spinner replaces label, width locked to prevent reflow). 44px min. Overflow: label truncates, never wraps to two lines. |
| `IconButton` | 44px target even when the glyph is 20px — pad, do not shrink. `aria-label` required by types, not convention. |
| `Field` | Label, hint, error, prefix/suffix. Error is announced via `aria-describedby` and `aria-invalid`. 16px font minimum or iOS zooms on focus. Overflow: hint wraps, label truncates. |
| `Select` | Native `<select>` on mobile — the OS picker is better than anything custom and is already localised. Custom listbox only above 900px. |
| `DateField` | Never `new Date(string)` — see `Calendar.tsx` for the arithmetic weekday derivation and the reason. |
| `Sheet` | Bottom sheet on mobile, dialog above 900px. Focus trap, `Esc` to close, focus returned to the trigger on close, scroll locked on the body behind it. Motion: spring from the bottom, no bounce on close. |
| `Tabs` | The sliding `layoutId` indicator already proven in `Segmented`. Arrow-key roving tabindex. |
| `Accordion` | Height animation must use `height: auto` via Motion's layout, not a max-height guess. |
| `Tooltip` | Touch has no hover — long-press on mobile, and never the only route to information. |
| `Table` | Overflow is the whole problem: horizontal scroll inside its own container with a sticky first column, never page-level scroll. |
| `Skeleton` | Shaped like the content it replaces, so nothing jumps on arrival. Already proven on Chart. |
| `Badge` | Status must not be colour-only: pair every colour with a shape or a word. |
| `Avatar` | Initials fallback, deterministic colour from the public id. |
| `Progress` | Determinate and indeterminate; `role="progressbar"` with the values set. |
| `Toast` | Built. Extend with a queue — currently a second toast replaces the first. |
| `Empty` | Built. |
| `ErrorState` | Not built. Needs: what failed, whether retrying will help, and a retry that actually refetches. |

### 4.3 Motion rules

Write these down in the library, because inconsistent motion reads as
brokenness rather than as style:

- Enter 320ms, exit 180ms. Exit is always faster; matching them feels sticky.
- Springs for anything that moves *position*; durations for anything that
  changes *opacity*.
- One orchestrated reveal per screen, staggered at 55ms. Not per component —
  a page where everything animates independently is noise.
- `prefers-reduced-motion` in every component, no exceptions. Reduced motion
  means content arrives *already in place*, never that it fails to arrive.
- Never animate `width`/`height`/`top`/`left`. Transform and opacity only.

### 4.4 Overflow and corner cases — the checklist

Apply to every component before calling it done:

1. Longest plausible string — a 40-character German compound, an untruncated
   email, a pasted URL.
2. Empty string, and `null`.
3. One item; zero items; 200 items.
4. 320px viewport width (an iPhone SE is still in use).
5. 200% browser zoom.
6. `prefers-reduced-motion: reduce`.
7. Keyboard only: reachable, visibly focused, operable.
8. Slow network: what shows for the three seconds before data arrives.
9. Failed request: what shows, and can the user retry without a reload.

---

## 5. Migration, screen by screen

Do not rewrite the app in one pass. Per screen: swap layout to `Shell` +
`Section`, replace primitives with Antara, mount the mapped Beautiful UI
component, then re-run the audit at 390px and 1280px.

Order — least to most risk: `Devices` → `You/Me` → `Calendar` → `Today` →
`Ask` → `Life` → `Chart`. Chart last: it is the most bespoke and the least
likely to benefit.

After each screen:

```bash
node .claude/skills/run-horamind/audit.mjs /tmp/hm-audit 390 844 9470
node .claude/skills/run-horamind/audit.mjs /tmp/hm-audit-d 1280 900 9471
```

**Look at the images.** Every UI defect found so far — the clipped day strip,
the identical day marks, the overflowing chart glyphs — passed every automated
assertion in the driver.

---

## 6. Smaller things that are easy to forget

- **No cookie banner is needed.** The only cookie is the httpOnly refresh token,
  which is strictly necessary for authentication and therefore exempt. Adding a
  banner would be a self-inflicted wound.
- **Offline.** The PWA precaches the shell but every screen needs the network.
  At minimum, cache the last natal chart — it is immutable, so it is the safest
  possible thing to serve stale.
- **`public/icon-192.png` and `icon-512.png` still do not exist.** Until they
  do, Android refuses "Add to home screen", which is the entire point of a PWA.
  This has been true since before any of this work.
- **`apps/web` is still absent from the root `tsconfig` references**, so
  `npm run typecheck` does not cover the web client — only `vite build` does. It
  let four type errors through once already. Fixing it needs `composite: true`
  on that project.
