# FootballOS

Private, AI-assisted coaching workspace for one football staff: film ingestion, opponent
scouting with coach-reviewed labels, playbook and personnel records, and collaborative
weekly game plans with coordinator approval.

**Status:** under active development on the `integration` branch. The app runs against its
own API and a local [Ollama](https://ollama.com) vision model; the demo/mock mode and the
Module 7 simulated-AI prototype were removed on 2026-11-27 (`docs/team/DECISIONS.md` D-015;
`main` still holds the graded prototype). It is being built as an addition to
<https://hubandspokerecruiting.com/> and can be mounted under a path prefix of that site.

## Layout

| Path | Contents |
| --- | --- |
| `apps/web` | React 19 + Vite web app: landing page, sign-in and the team workspace over the API; see [its README](apps/web/README.md). |
| `apps/api` | Hono API server, SQLite (better-sqlite3 + Drizzle) migrations, background job worker. |
| `packages/contracts` | Authoritative zod schemas and API types (see `docs/team/CONTRACTS.md`). |
| `packages/media` | Upload validation, ffmpeg proxies and thumbnails, play segmentation, footage quality. |
| `packages/ai` | Ollama vision adapter (local open-source model), label inference, deterministic scouting statistics, evaluation harness. |
| `fixtures/` | Test fixtures: six credited end-zone clips (`media/clips`), playbook documents, anonymized Hudl exports. |
| `docs/team` | Task board, decisions, contracts, workflow for the development team. |
| `docs/` | Module 7 submission documents (unchanged). |

## Development

Requires Node 22 or newer and npm 10+, plus [Ollama](https://ollama.com) with a vision model
for label inference (`ollama pull qwen3-vl:4b`; the API tells you truthfully when it is not
running and manual labeling keeps working). No system ffmpeg, Docker or database server is needed.

```bash
npm install
npm run typecheck
npm test
npm run dev -w apps/api     # API + worker on http://127.0.0.1:8787 (copy apps/api/.env.example to apps/api/.env first)
npm run bootstrap -w apps/api   # once: create the team and its first head coach
npm run dev:web             # web on http://localhost:5174, proxying /api to the API
```

Each app documents its own environment variables in `.env.example`. Secrets are never
committed. See `docs/team/WORKFLOW.md` for branch, port and data-directory conventions.
