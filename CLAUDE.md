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

## Module 13 final project (due 11:59 pm Eastern, Dec 19, 2026; Canvas shows 2026-12-20T04:59Z; 100 pts)
Deliverable: a 10-15 minute recorded presentation of the AI product prototype, plus the slide deck, and a
reflection (up to 400 words, PDF/DOCX) with the group participation evaluation. Graded on two criteria,
50 pts each: thoroughness of the final result, and presentation clarity, organization and language.
- Rubric detail, top band (47.5-50) on each criterion:
  - Thoroughness: all requirements met; every claim backed by cited, available evidence; prototype creative and
    believable; multiple screenshots or a demo video. A video showing the prototype actually working earns +10
    bonus points, so record a live walkthrough. Proficient needs at least one reference beyond course materials.
  - Clarity: key points clear, logical flow, engaging delivery (inflection, not reading slides or a paper),
    duration and slide count within guidelines, no language errors on slides, all sources cited accurately.
  - Score any draft deck against these bands and list gaps before delivery.
- Process: (1) share slides in the group forum (group of 2-5) and give written feedback to every member;
  (2) revise the deck from teammates' feedback and credit adopted ideas on the slide; (3) record the 10-15 min
  video (Zoom cloud recording, submit the link); (4) write the reflection and complete the group participation
  evaluation for every member (submit as two files or one combined PDF/DOCX).
- Reflection (max 400 words) covers all build stages: what surprised me, what was difficult, what was easy, whether
  feedback helped and how I responded. Keep it accurate to what happened, and keep any AI-use disclosure accurate.
- Required slides, in order: title; problem statement; user persona and stakeholder needs (how the need was
  validated); solution overview; AI methodology and tech stack (concept over math, data sources, preprocessing);
  prototype demo (AI-driven interactions highlighted); design choices and iteration (feedback, A/B results);
  impact and metrics (OKRs/KPIs, ROI); scalability and future directions; references (APA 7).
- Brief and rubric: local Canvas scrape, `Fall2026 - Developing AI Solutions/assignments/` (Module 13 files).
  The scrape lags, so state its as-of date and re-check Canvas for changes before submitting.
- Tablet workflows: landscape tablet (768x1024) and desktop are the primary layouts; no horizontal overflow at
  1280x860, 768x1024 and 375x812. Demo these flows on tablet: sign-in, film upload, coach label review, game plan
  approval. Rationale: `docs/MODULE7_DESIGN_RATIONALE.md`; test plan: `docs/USABILITY_TEST_PROTOCOL.md`.
- AI feature acceptance: criteria and evaluation method are in `docs/ai/EVALUATION_PLAN.md`. In the demo, show
  each AI feature running live on local Ollama; state plainly anything degraded (Ollama down, manual labeling).
- Demo data: `fixtures/media/clips` (six credited end-zone clips) and `fixtures/documents` (demo playbook, notes,
  anonymized). Never show real Hudl data or real names in the demo or the deck.
