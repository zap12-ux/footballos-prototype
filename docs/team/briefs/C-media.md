# Brief C — Media / Document Processing Engineer (task A3)

Read `COMMON.md` first. Worktree: `/Users/zachariahparkhill/Projects/FootballOS/.worktrees/c-media`, branch `wt/c-media`.
Allowed paths: `packages/media/**`, `fixtures/media/**`. Data dir for scratch output:
`.data/wt-c` (gitignored).

## Goal
A library package `@footballos/media` that the API's job worker will host in Milestone B:
validate uploaded film, produce playback proxies and thumbnails, propose play boundaries
for fixed-camera coaching film, keep every derived time mapped to the original file,
assess footage quality honestly, and provide the job-runner semantics (lease, heartbeat,
bounded retry, cancel, restart recovery, idempotency) as a store-agnostic module.

## Fixtures available now
Six real end-zone clips (6–9 s each, CC BY-NC 4.0, credited) at
`apps/web/public/demo-film/play-1.mp4` … `play-6.mp4`. Copy nothing; reference them by
path from tests, and build a longer synthetic test asset at test time by concatenating the
six clips with 3–5 s of black between plays (ffmpeg concat) into `.data/wt-c/`. No full
game exists yet; design for one (90–180 minutes, 1080p, fixed sideline) and say what is
untested.

## Stack (decided)
TypeScript ESM, `ffmpeg-static` and `ffprobe-static` (bundled binaries; invoke with
`child_process.execFile` and argument arrays, never shell strings), `zod` for config,
vitest. Use types from `docs/team/CONTRACTS.md` §5 (`MediaAsset`, `FootageQuality`,
`ProcessingJob`, `PlaySegment`); until `@footballos/contracts` lands, declare local
structural types with the same field names in `src/types.ts` and note it in the handoff.

## Deliverables
1. `probe(path)`: container, codecs, duration, width/height, fps, start time offset,
   rotation; `validate(probe, limits)`: allowed containers/codecs, max duration, max
   bytes, min resolution; returns `{ ok, reasons[] }` with plain-language reasons.
2. `makeProxy(src, out, { height: 720, crf, preset })` preserving timestamps (`-copyts`
   where sane, or record `proxyOffsetSec`), `makeThumbnailSheet(src, out, { everySec })` and
   `thumbnailAt(src, atSec)`; all return the mapping needed to convert proxy/thumbnail time
   to original seconds (`toSourceSec`, `toProxySec` helpers with tests).
3. `proposeSegments(src, opts)`: per-second motion energy from ffmpeg (`select`/`scene`
   scores or `signalstats` difference metrics parsed from `-vf ... metadata=print`),
   smoothing, onset/offset detection with pre-roll and post-roll, minimum play length,
   merge of near gaps; output `PlaySegment`-shaped proposals with `origin:'proposed'`,
   ordered, non-overlapping, in original seconds, plus a `confidenceNote` string (words,
   not a score). On the synthetic asset it should find about six segments; report the
   actual count. Document failure modes (pans, zooms, replays, scoreboard overlays).
4. `splitSegment(seg, atSec)`, `mergeSegments(a, b)` pure functions that return new
   segments and the `supersededBy` relationship (originals are never mutated).
5. `assessQuality(src, probe, samples)`: resolution/fps class, exposure/blur proxies if
   cheaply available, camera stability estimate from global frame difference statistics,
   and an explicit `unevaluable: string[]` listing what this module cannot judge (e.g.
   "line of scrimmage visibility", "all 22 in frame") so the UI can say so.
6. `jobs/`: `JobRunner` with a `JobStore` interface (`claim(workerId, leaseSec)`,
   `heartbeat`, `complete`, `fail`, `requestCancel`, `recoverExpiredLeases`), an in-memory
   store for tests, handler registry by `kind`, bounded retries with backoff
   (`maxAttempts`), cooperative cancellation via `AbortSignal` passed to handlers, progress
   callbacks, idempotency key check before enqueue. Tests: retry then succeed, exhaust
   retries → failed, cancel mid-run, lease expiry → re-claim by another worker, duplicate
   enqueue returns the existing job.
7. CLI `bin/media.mjs probe|proxy|thumbs|segments|quality <file>` for manual checks.
8. README: what is implemented, tested on which fixtures, limits defaults (max 8 GB, 4 h,
   mp4/mov/mkv, h264/hevc), and what remains unverified without a full game.

## Acceptance (TASK_BOARD A3)
Unit tests on the six clips and the synthetic asset: probe fields, proxy produced,
thumbnails produced, segment proposals with source-mapped timestamps; job runner tests for
retry/cancel/restart. `npm run typecheck -w packages/media`, `npm test -w packages/media`.

## Genuine owner questions you may ask
- Default upload limits for one game (recommend 8 GB / 4 h) and proxy height (recommend
  720p). Non-blocking; use the recommendation meanwhile.
