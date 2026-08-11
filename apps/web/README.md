# @horamind/web

The HoraMind PWA. Mobile-first, installable, and written so a React Native port
is mechanical rather than a rewrite.

```bash
npm run dev --workspace @horamind/web     # localhost:5173, proxies /api to :8080
npm run build --workspace @horamind/web   # dist/
```

## Same origin, on purpose

The dev server proxies `/api` to the Fastify server on port 8080, which is how
production is served too — Caddy splits one hostname between the API and this
bundle. That is not a convenience: the refresh token lives in an `httpOnly`,
`SameSite=Strict` cookie, and a cookie only protects a site that owns the
origin. A separate `api.` subdomain would forfeit it and reintroduce CORS.

## React Native readiness

Only `src/components/` and `src/App.tsx` are DOM-aware. Everything else — the
screens, the API client, the stores, the theme — uses no browser global, and an
ESLint rule enforces that rather than trusting anyone to remember.

| Layer | Ported by |
|---|---|
| `theme/tokens.ts` | Nothing. Numbers are unitless; only `toWebStyle` is web-specific |
| `components/primitives.tsx` | Swapping `div`/`p`/`button`/`input` for `View`/`Text`/`Pressable`/`TextInput` |
| `routes/routes.ts` | Nothing. It is data; build `expo-router` from the same table |
| `lib/tokenStore.ts` | Implementing the interface with `expo-secure-store` |
| `lib/api.ts` | Nothing. `fetch` only |
| `screens/` | Nothing |

## Missing before install works

`public/icon-192.png` and `public/icon-512.png` are referenced by the manifest
but not committed — binary artwork is not something this repo generates. Until
they exist the app runs fine in a browser but **Android will refuse to offer
"Add to home screen"**, which is the whole point of a PWA.

The 512 needs a `maskable` safe zone: keep the artwork inside the central 80%,
because Android crops adaptive icons to a circle. `public/favicon.svg` is the
source to export from.
