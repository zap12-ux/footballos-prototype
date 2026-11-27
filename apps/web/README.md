# FootballOS web app

`apps/web` is the FootballOS product: a public landing page, sign-in and the authenticated
team workspace, built against `docs/team/CONTRACTS.md` and served by `apps/api`. There is no
demo mode and no simulated AI: every record comes from the API, and every model label comes
from the API's worker calling a local Ollama vision model (see `packages/ai`). The Module 7
usability prototype that used to live under `/prototype/` was retired on 2026-11-27
(DECISIONS D-015); it remains in git history and on the `main` branch.

## Run it locally

Requires Node 22 or newer. Start the API first (it needs Ollama for inference; see
`apps/api/README.md`), then the web app:

```bash
npm install                      # once, at the repository root
npm run dev -w apps/api          # API on http://127.0.0.1:8787
npm run dev -w apps/web          # web on http://localhost:5174 (the Claude launch config uses 5173)
```

Vite proxies `/api` and `/media` to `http://localhost:8787`; set `VITE_API_PROXY_TARGET` to
point at another API port. In production the reverse proxy serves the built `dist/` and
forwards the same two prefixes to the API; when the web app is served from another origin
set `VITE_API_BASE_URL` at build time. To mount the app under a path of a larger site (for
example `/footballos/` on hubandspokerecruiting.com) build with `VITE_BASE_PATH=/footballos/`;
the router `basename` follows Vite's `BASE_URL`, and the build copies `index.html` to
`404.html` so a host without rewrites still serves deep links.

The first head coach is created by the API's interactive CLI (`npm run bootstrap -w apps/api`);
everyone else joins by invitation. There is no self-registration and no demo account.

Other commands:

```bash
npm test -w apps/web           # Vitest + React Testing Library
npm run typecheck -w apps/web  # tsc --noEmit
npm run build -w apps/web      # production build to dist/
npm run preview -w apps/web    # serve the production build
```

## Routes (react-router 7, path-based, refresh-safe)

| Path | Screen |
| --- | --- |
| `/` | Public landing page: product explanation, hero montage (see below) and **Sign in**. |
| `/sign-in` | Email + password, then the MFA code step, with account recovery. |
| `/app` | Dashboard: this week's game, open tasks, recent film, plan statuses. |
| `/app/schedule` | Season table, record from final games only, manual add/edit, CSV import preview → apply. |
| `/app/film` | Our Team Film: upload context form, processing progress, rejection reasons, proposed play list. |
| `/app/film/:assetId` | Asset view: footage quality, jobs, proxy player with thumbnails, segment timeline, label review. |
| `/app/scouting` | Opponent Scouting: opponent/unit selector, findings with denominators and review-basis flags, uncertain findings apart. |
| `/app/plans` | Weekly Game Plans: unit tabs, CONTRACTS §11 section templates, draft / in review / approved versions, comments. |
| `/app/playbook` | Documents, versions, proposed vs approved concepts with sources. |
| `/app/personnel` | Roster, depth chart, packages with availability. |
| `/app/staff` | Members, roles, invitations. |
| `/app/settings` | Team details, media retention, your account. |
| anything else | 404 page. |

Unauthenticated visits to `/app/*` redirect to `/sign-in?next=…` and return afterwards.
The workspace context (`?team=&season=&game=&unit=`) lives in the URL and is mirrored in a
small store (`src/workspace/store.ts`), so every page agrees on team, season, game and unit
and links between pages carry it. Every workspace screen shows the environment label from
`Team.environmentKind` (demo, research or production).

## API client

`src/api/http.ts` is the one `Api` implementation: `hc<AppType>` from `hono/client`, typed by
the API's own route table (`import type { AppType } from '@footballos/api'`, type-only).
Every route the API implements is called through the typed client, so a server-side change
to a path, parameter or response shape fails `npm run typecheck -w apps/web`. Routes the API
has not implemented yet go through a small `raw()` helper with the same error-envelope
handling. `src/api/contracts.ts` re-exports every type from `@footballos/contracts` (aliased
to the package source) and adds only coach-facing constants and pure helpers.

## Film workflow (CONTRACTS §14)

1. **Upload** (`src/film/uploadClient.ts`, §14.1). The context form asks four questions once
   (whose film, unit, camera, how to tell the teams apart). Files under 2 GB are fingerprinted
   (sha256) in a Web Worker so an exact duplicate is refused before any byte moves; larger
   files skip the hash and the status says so. Bytes go as `PUT /uploads/:id` ranges of the
   server's `chunkSizeBytes`. A `409` with `receivedBytes` moves the client to the server's
   position; network failures retry with backoff; **Cancel** takes effect at the next chunk
   boundary. In-flight uploads are kept in `localStorage` so an interrupted upload can resume
   after a reload when the same file is chosen again.
2. **Jobs** (`src/film/jobPolling.ts`, §14.2) are polled every 3 s while any job is queued,
   running or waiting to retry; cancel and retry are per job.
3. **Asset view** (`src/pages/AssetPage.tsx`). Footage quality notes and the *could not
   evaluate* list are shown verbatim. The player streams the proxy through a media grant
   (§14.3) that is renewed before it expires. `?t=<sec>` (evidence links from scouting) opens
   the player at that time on the play that contains it; every seek goes through `planSeek`
   (`src/film/review.ts`) and a time the proxy cannot show is refused with a message, never
   seeked silently.
4. **Segment timeline** (`src/film/SegmentTimeline.tsx`, §14.4): accept, reject, split at
   playhead, merge with next; every write carries `expectedVersion` and a `409` is shown as
   "changed elsewhere, reload". Keys: `↓`/`→` next play, `↑`/`←` previous, `Home`/`End`,
   `Enter`/`Space` play, `N` next in review queue, `A` accept, `R` reject, `S` split, `M` merge.
5. **Label review** (`src/film/LabelReview.tsx`, §14.5): plays × label keys with the value in
   use, the model's abstention, an uncertainty word (never a number that was not measured),
   the accepted status and who reviewed it when. The correction panel shows the model
   provenance for that play (model, prompt hash, the exact frames inspected with clickable
   timestamps, tokens, latency). *Accept inferred labels in view* applies the §14.5 rule after
   a confirmation that states how many labels change. *Run inference* posts
   `POST /assets/:id/infer`; when Ollama is not running or the model is not pulled the job
   fails with `provider_unavailable`, the page says so, and manual labeling stays available.
   No screen ever fills in a value the model did not give.
6. **Opponent Scouting** (`src/pages/ScoutingPage.tsx`, §14.6) shows a report computed on the
   server: sample size, the games it came from, each finding's numerator, denominator and
   excluded plays, evidence timestamps as links into the asset view, uncertain findings apart.
7. **Settings** (`/app/settings`, §14.7): retention days with `expectedVersion` (head coach
   only); the server's upload limits are shown, not edited.

## Landing hero montage

The hero reads `public/montage/manifest.json` (`poster`, `clips[]`). Clips play muted and
inline, chained and looped, with a visible pause/play control; with `prefers-reduced-motion`
only the poster shows. The manifest ships with an empty `clips` list and the designed poster
until the owner provides AI-generated clips (DECISIONS D-011); no evaluation footage is used.

## Styles

`src/styles/tokens.css` holds the semantic tokens (surface, line, ink, navy, crimson, gold,
status, focus, radius, type scale, spacing). `src/styles.css` is the shared base stylesheet
(buttons, cards, callouts, tables, form states); `src/styles/shell.css` styles the shell.

## Tests

`npm test -w apps/web` runs the shell suite in `src/tests/shell/` (routing, auth gating,
montage, context query, every screen, axe-core on landing, dashboard, film, asset view and
scouting), the film suite in `src/tests/film/` (upload client against a fake §14.1 server,
job polling with fake timers, the bulk-accept rule and filters, the asset view end to end)
and the iteration-1 suite in `src/tests/iteration1/` (unsaved-work guard, evidence links,
approval history). Screen tests render the real app against `src/tests/fakeApi`, a test-only
in-memory implementation of the `Api` interface seeded with the fictional Winchester Hawks
records; it is never bundled into the app. `src/tests/setup.shell.ts` works around a
jsdom/undici `AbortSignal` mismatch that react-router's data routers hit under vitest.
