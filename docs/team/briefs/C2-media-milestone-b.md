# Brief C2 — Media / Document Processing Engineer, Milestone B (task B2-lib)

Read `COMMON.md` first, then `docs/team/CONTRACTS.md` §5 and **§14.8**, and
`packages/media/README.md` (your own Milestone A work is in `integration`). Worktree:
`/Users/zachariahparkhill/Projects/FootballOS/.worktrees/c2-media`, branch `wt/c2-media`.
Allowed paths: `packages/media/**`, `fixtures/media/**`. Scratch output: `.data/wt-c2`.

## Deliverables (commit a WIP after each)
1. Replace the structural types in `packages/media/src/types.ts` with imports from
   `@footballos/contracts` (`MediaAsset`, `FootageQuality`, `ProcessingJob`, `PlaySegment`,
   `EvidenceRef`); keep a thin local alias file so tests compile. If a contract field is missing,
   say so in the handoff (do not edit `packages/contracts`).
2. `extractFrames(src, timestampsSec, { height = 720, quality })` → ordered
   `{ atSec, jpeg: Buffer, width, height }[]` using one ffmpeg invocation per call where possible
   (select by timestamps, scale, mjpeg to a temp dir, read back); exact `atSec` echo; tests on
   play-1 (1 fps over the clip, ordered, dimensions reported, missing-timestamp behaviour past EOF
   documented).
3. `createMediaHandlers({ dataDir, limits, proxy, thumbnails })` per §14.8 with the exact input
   and result shapes; handlers honour `ctx.signal` (abort kills the ffmpeg child) and call
   `ctx.progress`; `segment` uses `proposeSegments` and returns `PlaySegment`-shaped proposals with
   `origin:'proposed'`; `validate` returns `{ ok, reasons, probe, quality }` using `assessQuality`.
   Tests: run the four handlers in sequence on play-1 through the in-memory `JobRunner`, check
   outputs on disk and result shapes; abort mid-proxy leaves no partial output behind.
4. Frame-rate/time correctness: a test that `extractFrames` timestamps map back through
   `toSourceSec` for a proxy with a non-zero `startTimeSec` (synthesize with `-itsoffset`).
5. Thumbnail tile access helper `thumbTile(sheetPath, n) → { x, y, w, h }` and a single-frame
   fallback for grants (B serves `/media/:id/thumb/:n`).
6. README: new APIs, the handler contract, what remains unverified on a full game.

## Acceptance (board B2-lib)
`npm run typecheck -w packages/media`, `npm test -w packages/media` green with the new tests;
handlers consumable by B exactly as §14.8 states (B codes against that signature in parallel).

## Owner question
None expected; defaults are decided. If something genuinely needs the owner, ask non-blocking.
