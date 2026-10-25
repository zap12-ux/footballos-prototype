# Brief A — Product Designer / Frontend Engineer (task A2)

Read `COMMON.md` first. Worktree: `/Users/zachariahparkhill/Projects/FootballOS/.worktrees/a-frontend`, branch `wt/a-frontend`.
Allowed paths: `apps/web/**` only. Ports: web dev 5174 (`--port 5174`), API proxy target
`http://localhost:8789` (B's API, may not be running; the app must work in mock mode).

## What already exists (preserve it)
`apps/web` is the graded Module 7 usability prototype: React 19, Vite 6, TypeScript 5,
Vitest, hash routes `#/`, `#/demo`, `#/research`, a session reducer in `localStorage`, and
58 passing tests (`npm test -w apps/web`). Its screens, copy, trust rules and tests must
keep passing unchanged. Read its `README.md` and `src/styles.css` (palette: dark navy
surfaces, crimson for selective emphasis, restrained burnt gold accents) before designing.

## Goal
Turn `apps/web` into the FootballOS product shell with a public landing page and an
authenticated team workspace, built against `docs/team/CONTRACTS.md`, while the prototype
remains reachable as the film-review demo flow.

## Deliverables
1. Design tokens in `apps/web/src/styles/tokens.css` (you own this file): extract the
   existing palette into semantic tokens (surface, line, ink, navy, crimson, gold, focus,
   radius, type scale) and use them for all new screens. The prototype's own CSS keeps
   working.
2. Routing with `react-router` 7 (`createBrowserRouter`): refresh-safe paths, back/forward,
   `basename` from `import.meta.env.BASE_URL`. Routes: `/` landing, `/sign-in`,
   `/app` dashboard, `/app/schedule`, `/app/film`, `/app/scouting`, `/app/plans`,
   `/app/playbook`, `/app/personnel`, `/app/staff`, `/app/settings`, and
   `/prototype/*` mounting the existing `App` unchanged (its hash routes keep working under
   that path). For the GitHub Pages static build copy `index.html` to `404.html` at build.
   Global routing file `apps/web/src/app/router.tsx` is yours.
3. Context selection kept in the URL query (`?team=&season=&game=&unit=`) and mirrored in a
   small store, so every workspace page agrees on team, season, opponent/week and unit.
4. API layer `apps/web/src/api/`: `HttpApi` using `hono/client` typed by
   `import type { AppType } from '@footballos/api'` **once that package exists**; until then
   write an interface `Api` from the CONTRACTS.md §12 shapes and implement `MockApi` with
   clearly labeled demo data (fictional Winchester Hawks) in `src/api/mock/`. Select with
   `VITE_API_MODE=mock|http`. Every screen shows an environment label (`demo` /
   `research` / `production`) from `Team.environmentKind`.
5. Screens (content-complete with mock data, wired to the `Api` interface): landing
   (below), sign-in (email, password, MFA code step, recovery link, errors), dashboard
   (this week's game, open tasks, recent film, plan statuses), schedule (table, import
   preview stub, manual add/edit, states, results, record), Our Team Film (asset list,
   upload context form, processing progress, segment list placeholder), Opponent Scouting
   (opponent/unit selector, findings with denominators and review-basis flags, uncertain
   findings section), Weekly Game Plans (unit tabs, section templates from CONTRACTS §11,
   draft/approved badges, comments panel), Playbook (documents, versions, proposed vs
   approved concepts), Personnel (roster, depth chart, packages), Staff & settings
   (members, roles, invites, retention). Visible loading, saving, success and recovery
   states; optimistic UI is not required.
6. Landing page: hero with a football montage `<video muted loop playsinline>` built from
   the six credited clips in `public/demo-film` (CC BY-NC 4.0, credit line visible), poster
   image fallback (generate a still from a clip with ffmpeg if available, otherwise a
   designed SVG poster), a visible pause/play control, honor `prefers-reduced-motion` (show
   poster, no autoplay), clear product explanation, "Sign in" and "Try the demo" actions
   (demo → `/prototype/#/demo`). No fabricated customers, testimonials or metrics. Record in
   `apps/web/README.md` that the montage uses the credited clips as a documented fallback
   until owner-provided footage exists.
7. Accessibility and layout: keyboard reachable navigation, skip link, focus management on
   route change, headings in order, 320 px to desktop layouts (sidebar collapses to a menu
   below 960 px). Run `axe-core` in a vitest for landing and dashboard.
8. Tests: existing 58 pass; new tests for routing (direct URL to each route renders,
   404), auth gating (unauthenticated `/app/*` redirects to `/sign-in`), montage controls
   (pause toggles, reduced motion shows poster), context query persistence, mock api
   screens render denominators and environment label. `npm run typecheck -w apps/web`.

## Acceptance (TASK_BOARD A2)
All routes render via direct URL; existing 58 tests pass; new tests pass; axe-clean landing
and dashboard; prototype flow unchanged under `/prototype`.

## Genuine owner questions you may ask
- Whether the public landing page should mention the course context (Georgetown module)
  or present as a product site only. Recommend: product site with a short footer line.
Do not ask about palette, routing library, pages or montage footage: decided above.
