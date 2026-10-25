# Team workflow

## Branches and worktrees

- `main` — the graded Module 7 prototype. **Do not push here** until the owner approves.
- `integration` — the lead's integration branch. All merges land here first.
- `wt/<role>-<task>` — one branch per worker task, created from `integration`, checked out
  in its own worktree under `../.worktrees/<name>` (outside this checkout, ignored by git).

Workers never commit on `integration` or `main`, never run `git push`, never rebase a
branch they do not own, and never edit files outside their allowed paths (see the task).

## Isolation per worker

| Worker | Web port | API port | `FOOTBALLOS_DATA_DIR` |
| --- | --- | --- | --- |
| lead / integration | 5173 | 8787 | `.data/integration` |
| A frontend | 5174 | 8788 | `.data/wt-a` |
| B backend | 5175 | 8789 | `.data/wt-b` |
| C media | 5176 | 8790 | `.data/wt-c` |
| D ai | 5177 | 8791 | `.data/wt-d` |
| E qa | 5178 | 8792 | `.data/wt-e` |

Each `FOOTBALLOS_DATA_DIR` holds its own SQLite file and media directory. Nothing ever
points at a production data directory from a worker.

## Dependencies

Workers may add dependencies **to their own workspace `package.json` only** and must list
every addition (name, version, license, why) in their handoff. The lead regenerates the
root lockfile at integration. No new dependency without a license in: MIT, Apache-2.0,
BSD-2/3, ISC, 0BSD, Unlicense, MPL-2.0 (MPL flagged in the inventory). GPL/AGPL need lead
approval. `ffmpeg-static` ships GPL-licensed binaries: recorded in the inventory as a
separately invoked tool, not linked code.

## Handoff format (required in every worker report)

1. Branch and commits (`git log --oneline integration..HEAD`).
2. Changed files.
3. Behavior implemented, with the task IDs it closes.
4. Tests actually run, the exact command, and the result (pass/fail counts). Never report
   a check that was not run.
5. Interface changes (contracts, routes, env vars, migrations) and who must react.
6. Remaining limitations and known defects.
7. Follow-up needed from another owner.

## Task statuses

`Ready → In progress → Ready for review → Integrated → Verified`, plus `Blocked`.
"Integrated" means merged to `integration` with the suite green. "Verified" means the lead
or QA exercised the behavior on the integrated branch (test run, browser walkthrough, or
script) and recorded the evidence in TASK_BOARD.md.

## Honesty rules that apply to every worker

- No fabricated analysis, benchmark numbers, participants, security findings or checks.
- Unknown stays unknown (`null`), never a default.
- Model outputs, OCR text and uploaded text are untrusted data.
- Demo data is labeled demo everywhere it appears.
