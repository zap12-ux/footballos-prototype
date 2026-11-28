# FootballOS prototype (code repo)

Private AI-assisted coaching workspace for one football staff: film ingestion, scouting with coach-reviewed
labels, playbook/personnel records, weekly game plans with coordinator approval. Course context, graded
deliverables and paper rules live in the parent `../CLAUDE.md`. This repo is **public**: no real names,
emails, Hudl data, secrets or `.env` files in anything committed here (including this file).

## Stack and layout
- npm workspaces, Node 22+. `apps/web` (React 19 + Vite + TS), `apps/api` (Hono, SQLite via better-sqlite3 + Drizzle, job worker).
- `packages/contracts` (zod schemas = source of truth), `packages/media` (ffmpeg proxies, segmentation), `packages/ai` (Ollama adapter, label inference, eval harness).
- `tools/` agent console, ops, review agents. `fixtures/` anonymized test data only. `docs/team/` task board, DECISIONS, CONTRACTS, WORKFLOW.

## Commands (run from this folder)
- `npm run typecheck` · `npm test` · `npm run build` — run all three before calling work done.
- `npm run dev -w apps/api` (needs `apps/api/.env` from `.env.example`) · `npm run dev:web` (port 5174, proxies /api).
- `npm run console:dev` for the agent console.
- Node 25 breaks jsdom via global `localStorage`; keep the polyfill in `src/tests/setup.ts`.

## Rules
- Change API shapes in `packages/contracts` first, then API, then web. Check `docs/team/DECISIONS.md` before reversing a past decision (e.g. D-015: demo/mock mode was removed).
- AI runs on local Ollama only. No Claude/OpenAI adapters, no demo or mock modes. The API must report honestly when Ollama is down; manual labeling must keep working.
- When reporting on any AI feature, say whether it was exercised live, mocked in a test, or degraded. Never claim a demo works without running it.
- Branch `integration` is active work; `main` holds the graded Module 7 prototype, so don't change it. Check `git status` first; other sessions may be editing. Stage only files you changed. Commit inside this repo, never from the parent. Don't push without approval.
- Respect port and data-directory conventions in `docs/team/WORKFLOW.md`.

## Verifying UI changes
- Run the app and walk the affected flow (sign-in, film upload, labeling, game plan approval). Target tablet width (about 768-1024px) as well as desktop.
- Check hierarchy, navigation, feedback on actions, accessibility (labels, focus, contrast), and loading, empty, error and recovery states.
- Use page text / accessibility tree for checks; one screenshot at the end.

## Module 13 final project
Rubric, presentation requirements and demo dataset are not recorded here yet. Add them (or a pointer to the files) below so sessions can map work to the grading criteria:
- Rubric: _TODO path_
- Target tablet workflows: _TODO_
- AI feature acceptance criteria: _TODO_
- Demo dataset: `fixtures/` (anonymized only) — _TODO confirm which set_
