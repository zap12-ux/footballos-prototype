# FootballOS

Private, AI-assisted coaching workspace for one football staff: film ingestion, opponent
scouting with coach-reviewed labels, playbook and personnel records, and collaborative
weekly game plans with coordinator approval.

**Status:** under active development on the `integration` branch. `main` still serves the
Module 7 usability prototype at <https://zap12-ux.github.io/footballos-prototype/>.

## Layout

| Path | Contents |
| --- | --- |
| `apps/web` | React 19 + Vite web app. Contains the Module 7 prototype (simulated AI, research/demo modes) as the film-review demo flow; see [its README](apps/web/README.md). |
| `apps/api` | Hono API server, SQLite (better-sqlite3 + Drizzle) migrations, background job worker. |
| `packages/contracts` | Authoritative zod schemas and API types (see `docs/team/CONTRACTS.md`). |
| `packages/media` | Upload validation, ffmpeg proxies and thumbnails, play segmentation, footage quality. |
| `packages/ai` | Model adapters, label inference, deterministic scouting statistics, evaluation harness. |
| `docs/team` | Task board, decisions, contracts, workflow for the development team. |
| `docs/` | Module 7 submission documents (unchanged). |

## Development

Requires Node 22 or newer and npm 10+. No system ffmpeg, Docker or database server is needed.

```bash
npm install
npm run typecheck
npm test
npm run dev:web      # web on http://localhost:5173
```

Each app documents its own environment variables in `.env.example`. Secrets are never
committed. See `docs/team/WORKFLOW.md` for branch, port and data-directory conventions.
