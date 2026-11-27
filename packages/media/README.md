# @footballos/media

Film validation, playback proxies, thumbnails, proposed play boundaries, footage-quality
assessment, playbook document extraction (PDF / text / docx pages with offline OCR) and
store-agnostic job-runner semantics for FootballOS. A library hosted by the API job worker
(Milestone B); it has no HTTP surface of its own.

Everything runs locally: film through the bundled `ffmpeg-static` / `ffprobe-static` binaries
(invoked with `child_process.execFile` and argument arrays), documents through pdfjs-dist,
@napi-rs/canvas and tesseract.js in-process. No footage, document or text leaves the machine
and nothing is downloaded at run time.

## What is implemented

| Area | Entry points | Notes |
| --- | --- | --- |
| Probe and validate | `probe(path)`, `validate(probe, limits)`, `DEFAULT_UPLOAD_LIMITS`, `UploadLimitsSchema` | container family, codecs, duration, size, resolution, fps, start offset, rotation. `validate` returns `{ ok, reasons[], warnings[] }` in plain language. |
| Proxy | `makeProxy(src, out, { height: 720, crf: 23, preset: 'veryfast' })` | H.264/AAC MP4, never upscaled, 2 s keyframes, faststart, progress callback, abortable. Returns a `ProxyTimeMapping` (`proxyOffsetSec` is 0 by construction; measured duration drift is reported). |
| Thumbnails | `makeThumbnailSheet(src, out, { everySec: 10 })`, `thumbnailAt(src, atSec, out)` | Exact tile count (frames are extracted first, then tiled; a trailing partial period yields no tile, so `count = floor(duration / everySec)` or one more). Writes a `<out>.json` sidecar with the tile geometry. Mapping helpers `thumbIndexToSourceSec`, `sourceSecToThumbIndex`, `thumbRect`. `thumbnailAt` past the end of the file backs off toward the last decodable frame and reports both `requestedAtSec` and the `atSec` actually used. |
| Tile access (B2-lib) | `thumbTile(sheetPath, n) → { x, y, w, h }`, `thumbFramePath(sheetPath, n)`, `thumbTileJpeg(sheetPath, n)`, `thumbTileFromMapping` (pure) | For `GET /media/:assetId/thumb/:n`. Reads the sidecar; `thumbTileJpeg` returns the kept frame file when it exists, otherwise crops tile `n` out of the sheet with ffmpeg (`source: 'frame' | 'sheet_crop'`). `RangeError` outside `0..count-1`. |
| Frames by timestamp (B2-lib) | `extractFrames(src, timestampsSec, { height: 720, quality: 4 })`, `extractFramesReport` | One ffmpeg pass per call (per 240 timestamps): input seek to one second before the earliest timestamp, a `select` expression that takes the first frame at or after each timestamp, `showinfo` to map output files back to requests. Returns `{ atSec, jpeg, width, height, frameSec }[]` ascending by `atSec` with the requested value echoed exactly; `frameSec` is the decoded frame's own time (within one frame period after `atSec`). Never upscales. Duplicates collapse; timestamps at or past the end of the stream produce no entry and are listed in `extractFramesReport(...).missing`. Negative or non-finite timestamps throw `RangeError`. Abortable. |
| Job handlers (B2-lib) | `createMediaHandlers({ dataDir, limits, proxy, thumbnails })`, `asJobHandler`, `registerMediaHandlers(runner, handlers)` | The four handlers the API worker hosts; see "Handler contract" below. |
| Time mapping | `toSourceSec`, `toProxySec` | All stored times are seconds from the first presented frame of the original file; `ProbeResult.startTimeSec` keeps the container offset for anyone who needs PTS. |
| Play boundaries | `proposeSegments(src, identity, opts)`, `proposeSegmentsFromSeries(series, …)` (pure), `motionEnergy(src)` | Per-second motion energy from `signalstats` YDIF at 4 fps on 160-px frames; median smoothing; hysteresis onset/offset; min length; merge of near gaps before padding; pre/post roll; overlaps resolved at the gap midpoint. Output is `PlaySegment`-shaped with `origin: 'proposed'`, ordered and non-overlapping, plus a `confidenceNote` in words. |
| Split / merge | `splitSegment(seg, atSec)`, `mergeSegments(a, b)`, `renumber`, `findOverlaps` | Pure; inputs are never mutated; originals come back as copies with `supersededBy` filled and `version + 1`. Coach-made parts default to `reviewStatus: 'accepted'` (override with `reviewStatus`). |
| Quality | `assessQuality(src)`, `interpretQuality(probe, samples, windows)` (pure) | Resolution/fps class, exposure (mean luma, black-frame share), uncalibrated edge-density sharpness number, camera-stability estimate from whole-frame change statistics, and an explicit `unevaluable[]` list. |
| Jobs | `JobRunner`, `JobStore` interface, `InMemoryJobStore`, `idempotencyKeyFor`, `NonRetryableError` | claim with lease, heartbeat, progress, complete, fail with exponential backoff until `maxAttempts`, cooperative cancel via `AbortSignal`, lease-expiry recovery, duplicate enqueue returns the existing job. |
| Documents (C2-lib) | `extractDocument(path, outDir, { renderDpi: 110, ocr: 'auto' \| 'off' })`, `paginateText`, `documentSourceType`, `DocumentError` | PDF pages rendered to `outDir/pages/page-<n>.png` with pdfjs-dist + @napi-rs/canvas and their text layer read per page; `.txt` / `.md` paged 60 lines at a time; `.docx` converted by mammoth. Pages without a text layer go through offline OCR when available. See "Document extraction". |
| OCR (C2-lib) | `ocrAvailability()`, `createOcrEngine({ signal })` | tesseract.js with the English model read from the `@tesseract.js-data/eng` package on disk; never fetches. `recognize(png) → { text, confidence: 0..1 }`. |
| Document handler (C2-lib) | `createDocumentHandlers({ dataDir, renderDpi?, ocr? })`, `asDocumentJobHandler`, `registerDocumentHandlers(runner, handlers)` | `extract_document` in the §14.8 handler shape; writes `pages/` and `pages.json` atomically. |
| CLI | `bin/media.mjs probe|validate|proxy|thumbs|frames|segments|quality <file>`, `doc <file> <outDir> [--dpi N] [--ocr auto\|off]`, `doc-fixtures <outDir>` | Manual checks on the fixtures. Node ≥ 23.6 runs the TypeScript sources directly; on Node 22 add `--experimental-strip-types`. |

Record types (`MediaAsset`, `FootageQuality`, `ProcessingJob`, `PlaySegment`, `EvidenceRef`, …) are
imported from `@footballos/contracts` since Milestone B; `src/types.ts` only re-exports them and
keeps the Milestone A aliases (`MediaAssetStatus`, `MediaAssetContext`, `ProcessingJobKind`,
`ProcessingJobStatus`). `npm run typecheck` / `npm test` build the contracts package first
(`pretypecheck` / `pretest`); vitest resolves it from source.

## Package exports and types (for the API)

`package.json` `exports["."]` is `{ types: ./dist/index.d.ts, import: ./src/index.ts, default:
./src/index.ts }`. Node (≥ 23.6, native type stripping; the workspace symlink resolves to the
real `packages/media/src` path, so stripping applies) and vitest keep loading the TypeScript
sources; `tsc` in a consumer with `moduleResolution: NodeNext` resolves the **built**
declarations. Run `npm run build -w packages/media` (or `build:types`, declarations only;
`tsconfig.build.json` excludes `src/test`) before type-checking a consumer. With this, the
`paths` entry for `@footballos/media` in `apps/api/tsconfig.json` is no longer needed: the
API type-checks cleanly without it (verified locally, trace shows `dist/index.d.ts`).

## Handler contract (CONTRACTS §14.8)

```ts
const handlers = createMediaHandlers({
  dataDir,                                  // base for relative sourcePath / outDir
  limits: { maxBytes, maxDurationSec, … },  // merged over DEFAULT_UPLOAD_LIMITS
  proxy: { height: 720 },                   // makeProxy options
  thumbnails: { everySec: 10 },             // makeThumbnailSheet options; frames kept by default
});
// each: async (job: { id, input, teamId? }, ctx: { signal, progress(done, total, message) }) => result
// input: { assetId, sourcePath, outDir, teamId?, gameId? }
```

| Kind | Result | Files written in `outDir` |
| --- | --- | --- |
| `validate` | `{ ok, reasons, warnings, probe, quality }` | none |
| `proxy` | `{ proxyPath, mapping, durationDriftSec, width, height, durationSec, byteSize, fps, notes }` | `proxy.mp4` |
| `thumbnails` | `{ sheetPath, everySec, count, framesDir?, sidecarPath, mapping, sheetWidth, sheetHeight }` | `thumbs.jpg`, `thumbs.jpg.json`, `thumbs.jpg.frames/frame-00001.jpg …` |
| `segment` | `{ segments: PlaySegment[], confidenceNote, thresholds, segmentsPath }` | `segments.json` |

Behaviour that B relies on:

- **Paths.** `sourcePath` and `outDir` may be absolute or relative to `dataDir`. `outDir` is
  created. A missing source file throws `NonRetryableError('source_missing')`; an invalid
  input shape throws `NonRetryableError('bad_input')`.
- **validate** never throws for a bad upload: a file ffprobe cannot read comes back as
  `{ ok: false, reasons: ['The file could not be read as video (…)'], probe: null, quality: null }`;
  a file that breaks a limit comes back `ok: false` with the plain-language `reasons` from
  `validate()` and `quality: null` (quality is assessed only for files that pass, with
  `assessQuality`). `warnings` carries non-rejecting notes (rotation flag, low fps, extra
  streams). Progress: 0..3.
- **proxy** encodes to `proxy.mp4.part-<jobId>` and renames on success, so `proxy.mp4` is
  either absent or complete. `mapping` is a `ProxyTimeMapping` (`proxyOffsetSec: 0`;
  proxy time equals source time, see "Timing convention"); `durationDriftSec` above 0.5 s is
  also written into `notes`. Progress: seconds encoded / seconds total, at most once per
  second (`progressIntervalMs`).
- **thumbnails** builds into `.thumbnails-<jobId>.part/` and moves the sheet, sidecar and
  frames directory into place together, replacing any previous set. Tile `n` shows source
  time `n * everySec`; `thumbTile(sheetPath, n)` and `thumbTileJpeg(sheetPath, n)` serve
  `/media/:assetId/thumb/:n` (frame file first, sheet crop as the fallback, so B may delete
  `framesDir` to save space and still serve tiles).
- **segment** runs `proposeSegments` over the whole source and returns ordered,
  non-overlapping `PlaySegment`-shaped proposals with `origin: 'proposed'`,
  `reviewStatus: 'proposed'`, `supersededBy: []`, `version: 1`, fresh UUID `id`s and
  `index` from 0. `teamId` comes from `input.teamId`, else the job's `teamId`; `gameId` from
  `input.gameId`. **If neither is supplied the field is an empty string**: B should pass
  `teamId` and `gameId` in the input (it knows both at enqueue time) or set them on persist.
  The `confidenceNote` is the detector's own words ("clearly separated", "weakly
  separated", "nothing proposed because …") and should be shown next to the proposals.
- **Abort.** Every ffmpeg child runs with `ctx.signal`; an abort kills it, the handler
  removes its partial output and rejects with `MediaToolError` code `aborted`. The
  `JobRunner` then records the job as `canceled` (cancel request) or leaves it for recovery
  (lease lost / runner stopping). A handler invoked with an already-aborted signal does no
  work. Re-running a job after a crash is safe: outputs are rewritten, never appended.
- **Progress** is advisory: a throwing `ctx.progress` is swallowed so a store hiccup
  cannot fail the media work.
- **Runner adapter.** `registerMediaHandlers(runner, handlers)` registers the four kinds on
  this package's `JobRunner` (whose handler shape is `(ctx) => …`); `asJobHandler(h)` is the
  one-handler form. B's worker can use either or call the handlers directly from its own loop.

## Document extraction (CONTRACTS §15.1, §15.5)

```ts
const r = await extractDocument(path, outDir, { renderDpi: 110, ocr: 'auto', signal?, onProgress? });
// r = { pageCount, pages: { pageNumber, imagePath, width, height, text, textSource, ocrConfidence }[],
//       warnings: string[], sourceType: 'pdf' | 'text' | 'docx', ocr: { requested, engine, used } }
```

| Source | How | `textSource` |
| --- | --- | --- |
| `.pdf` | pdfjs-dist (legacy build, in-process fake worker) renders every page to `outDir/pages/page-<n>.png` at `renderDpi` on an @napi-rs/canvas canvas (Letter at 110 dpi = 935×1210 px), then reads the page's text layer (`getTextContent`, items joined in pdfjs order, line breaks where items end a line). | `pdf_text` when the layer has text; otherwise OCR (`ocr`) or `none` |
| `.txt`, `.md` | UTF-8, BOM stripped, CRLF normalised; one page per 60 lines (`linesPerPage`), original order; each page is also drawn on a white Letter page (10 pt monospace, long lines wrapped, overflow clipped) so every page has an image. | `pdf_text` (the text is authoritative, not recognised); `none` for an empty page |
| `.docx` | mammoth `extractRawText` (paragraphs separated by a blank line), then paged like `.txt`. Images, tables layout, drawings and headers are not extracted; mammoth's own messages become warnings. A file mammoth cannot open is rejected with `DocumentError('docx_failed')`. | as `.txt` |

Rules that hold for every page: nothing is invented, so a page whose text could not be read
has `text: null` and `textSource: 'none'`; `ocrConfidence` is `0..1` (tesseract's mean word
confidence / 100) only for `ocr` pages, else `null`; `imagePath` is `null` only when rendering
failed (a warning says so); pages keep the document's own order and 1-based numbers.
`warnings[]` is plain language: password-protected PDF (`pageCount: 0`, nothing extracted),
pages without a text layer (and whether OCR was off, unavailable or found nothing), render,
text-layer or OCR failures per page, empty documents. Unsupported extensions, missing files,
unreadable PDFs and unconvertible `.docx` throw `DocumentError` with a stable `code`
(`unsupported_type`, `source_missing`, `invalid_pdf`, `pdf_failed`, `docx_failed`, `text_failed`).

Abort: `signal` is checked before every page and before OCR; on abort the images already
written are removed, the OCR worker is terminated and the call rejects with `MediaToolError`
code `aborted`. Progress: `onProgress(done, total, message)` once before the first page and
once per finished page (during OCR, `total` is `Number.MAX_SAFE_INTEGER`, which the handler
reports as `null`).

Untrusted input: PDFs are opened with pdfjs without scripting or XFA support, fonts are not
installed into the process (`disableFontFace`), standard fonts and CMaps come from the
pdfjs-dist package on disk. OCR text and document text are data for the review UI; nothing
in this package interprets them.

### What OCR can and cannot do

- Engine: tesseract.js 7 (Apache-2.0) running `tesseract.js-core` WASM in a `worker_threads`
  thread, LSTM-only core. The English model is the `4.0.0_best_int` file (2.9 MB) from the
  `@tesseract.js-data/eng` npm package (MIT wrapper; the traineddata itself is the Apache-2.0
  tessdata), read with a local `langPath` and `cacheMethod: 'none'`, so **no CDN download and
  no cache file** are ever written. `ocrAvailability()` reports `available: false` with a
  reason when either package is missing, and `extractDocument` then returns scanned pages as
  `textSource: 'none'` with the warning "OCR engine not available (…)".
- `ocr: 'auto'` (default) OCRs only pages whose PDF text layer is empty; `ocr: 'off'` never
  starts the engine (warning "Page n has no text layer; OCR is off.").
- Measured on the generated scanned fixture (typed 34–48 px text, clean white page): all
  lines recognised, confidence 0.95, about 1.4 s for the first page including engine start
  (~1 s), well under a second per page after that.
- Not measured: real scans (skew, shadows, handwriting, low contrast), photographed pages,
  rotated pages (no orientation detection: the LSTM-only core cannot run `detect`), small
  print, tables, and play diagrams. Tesseract reads text only: circles, arrows and routes in
  a diagram produce nothing or garbage characters, which is why `textSource` and
  `ocrConfidence` travel with every page so the review UI can show them. English only.
- OCR runs one page at a time in one worker; a 60-page scanned playbook is roughly one
  minute. The handler reports progress per page.

### Handler

```ts
const { extract_document } = createDocumentHandlers({ dataDir, renderDpi: 110, ocr: 'auto' });
// async (job: { id, input: { assetId, sourcePath, outDir } }, ctx: { signal, progress }) => result
```

Writes `outDir/pages/page-<n>.png` and `outDir/pages.json` (`PagesFile`: version, assetId,
sourcePath, sourceType, renderDpi, ocr, pageCount, pages, warnings, extractedAt). Work happens
in `outDir/.extract-<jobId>.part/`; on success the old `pages/` and `pages.json` are removed
and the new ones moved into place together, so an abort or crash leaves neither images nor a
`pages.json` behind (a SIGKILL can leave the `.part` directory, which the next run of the
same job removes). Result = the `extractDocument` result (with final `imagePath`s) plus
`pagesPath`, `pagesDir`, `renderDpi`. Errors: `NonRetryableError` `bad_input`,
`source_missing`, or the `DocumentError` code (`unsupported_type`, `invalid_pdf`, …);
`MediaToolError('aborted')` on cancel, which the `JobRunner` records as `canceled`.
`registerDocumentHandlers(runner, handlers)` registers the kind `extract_document`.

For B (§15.1): `PlaybookPage.ocrText` ← `text`, `ocrConfidence` ← `ocrConfidence`,
`imageKey` ← `imagePath` relative to the asset dir; `textSource` is on every page. A
password-protected PDF comes back with `pageCount: 0` and a warning rather than a failure,
so the host decides how to show it.

## Defaults (confirmed by the owner, 2026-10-25)

| Limit | Default |
| --- | --- |
| Max file size | 8 GB |
| Max duration | 4 h |
| Containers | mp4, mov, mkv |
| Video codecs | h264, hevc |
| Minimum resolution | 1280x720 |
| Proxy height | 720 (crf 23, preset veryfast) |
| Thumbnail period | every 10 s, 320 px wide, 10 columns |

Timing convention: a browser shows the first frame of the original at `currentTime = 0`
regardless of the container's start offset, and ffmpeg normalises the same way when it
encodes the proxy, so proxy time equals source time. `makeProxy` still probes the result and
reports `durationDriftSec`; a value above 0.5 s is written into `notes` so the host can decide
whether to trust the mapping for that file.

## How play boundaries are proposed

1. One ffmpeg pass: `fps=4,scale=160:-2,signalstats` with `metadata=print` to a temp file.
   YDIF (mean absolute luma difference between consecutive analysed frames) is the energy.
2. Average per whole second, then a 3-second median filter (removes one-second dropouts,
   keeps edges). A moving average is available (`meanWindowSec`) but off by default.
3. Thresholds derived from the file itself: floor = 10th percentile, peak = 90th percentile,
   high = floor + 40 % of the spread, low = floor + 20 %. When the spread is below
   `minContrast` (2 YDIF units) nothing is proposed and the note says why.
4. Hysteresis: a play opens when energy exceeds `high`, closes after `offsetHoldSec` seconds
   below `low`. Runs shorter than `minPlaySec` (3 s) are dropped; runs closer than
   `mergeGapSec` (0.75 s) are merged.
5. Pre-roll (1 s) and post-roll (1 s) are added; if padding makes two proposals overlap, the
   boundary is put at the midpoint of the original gap so proposals never overlap.

### Result on the synthetic asset

The test suite builds `.data/wt-c/synthetic-game.mp4`: the six end-zone clips concatenated
with 3–5 s of black before, between and after plays (about 68 s). On this asset the detector
proposes **6 segments** (also 6 with `bin/media.mjs segments` on a trial build of the same
recipe), each covering one clip within 2 s at both edges. The confidence note for it reads "clearly separated" and also
flags that more than 60 % of the file is marked as plays, which is true for this asset and
would be unusual for real game film.

### Known failure modes (documented, not solved)

- **Camera pans and zooms** raise whole-frame energy exactly like a play; a camera that
  follows the ball from the snap will produce boundaries, but a camera that pans between
  plays will produce false plays or fuse two plays into one.
- **Replays and broadcast cuts** are hard scene changes with high energy; a replay of a play
  becomes a second proposal.
- **Scoreboard or clock overlays** that update every second add a small constant energy;
  with the adaptive thresholds this raises the floor but does not by itself create plays.
- **Huddles, substitutions and officials walking** are low but non-zero motion; on real film
  the gap between plays is not black, so the floor is higher than in the synthetic asset and
  the separation is weaker. The confidence note says "moderately" or "weakly separated" when
  that happens.
- **Pre-snap stillness**: an offense set at the line is nearly motionless, so the detected
  onset is the snap, not the break of the huddle. Pre-roll is the only compensation.
- **Very long or continuous motion** (a band, crowd shots, a sideline camera that never stops
  moving) produces one long proposal, which is flagged in the note when it exceeds
  `maxPlaySec` (45 s).

## What the quality assessment can and cannot say

`FootageQuality` (CONTRACTS §5) is filled as follows:

- `stable`: `true` when at least 15 % of sampled non-black frames show almost no change
  (what a fixed camera looks like between plays); `false` when the 90th percentile of the
  "moving area" fraction (share of a 64-px-wide frame whose luma changed by more than 16)
  exceeds 0.45; otherwise `null`. The 0.45 threshold was calibrated on one fixed end-zone
  clip (p90 0.16 mid-play) and a synthetic violently shaken copy of it (p90 0.55). Slow pans
  over a uniform field are **not** detected by this statistic and the `unevaluable` list says so.
- `lineOfScrimmageVisible`, `allTwentyTwoVisible`: always `null`; this module does not look
  at football content.
- `notes[]`: resolution and fps classes, exposure, black-frame share, stability reasoning.
- `unevaluable[]`: line of scrimmage, all 22 in frame, perspective, scoreboard legibility,
  replays/overlays, focus beyond an uncalibrated number, pans; plus "camera stability" when
  no quiet stretch was sampled.

Sampling: five windows of 4 s spread through the file (whole file when it is short), 4 fps,
320-px frames, so a 3-hour game costs about 20 s of decoding.

## Job runner

`JobRunner` is store-agnostic; `InMemoryJobStore` is the reference implementation and the
SQLite store belongs to the API (B). The store contract (`JobStore` in `src/jobs/types.ts`)
adds four store-internal fields to the contract's `ProcessingJob` (adopted in CONTRACTS
§14.2): `input`, `result`, `notBeforeAt` (retry wake-up) and `cancelRequestedAt`
(cooperative cancel of a running job). `Job.kind` is a plain `string` so the runner can host
kinds the `JobKind` enum does not list yet.
`markCanceled` is optional on a store; without it a canceled job is recorded as
`failed` with code `canceled`.

Semantics: `claim` is atomic and increments `attempt`; the runner heartbeats every
`leaseSec / 3`. Handlers receive an `AbortSignal` whose `reason` is one of
`'cancel_requested' | 'lease_lost' | 'runner_stopping'` (`AbortReason`). On
`cancel_requested` the job is recorded as `canceled`; on a lost lease the runner leaves the
record alone because another worker may own it; on `runner_stopping` the record is left
`running` so its lease expires and `recover()` re-queues it after restart; `recover()` moves
expired leases back to `queued` (or `failed` with `lease_expired` when attempts are
exhausted). Failures retry with `baseSec * 2^(attempt-1)` capped at `maxSec` (defaults 5 s
and 300 s, 20 % jitter) unless the handler throws `NonRetryableError`. `enqueue` returns the
existing job for a known `idempotencyKey` (`idempotencyKeyFor(kind, inputs, configVersion)`
is sha256 over canonical JSON).

## Tests

`npm run typecheck -w packages/media` and `npm test -w packages/media` (93 tests in 8 files,
about a minute on a laptop once the derived assets exist). The suite uses the
six clips at `fixtures/media/clips/play-1.mp4 … play-6.mp4` by path (nothing is copied)
and builds derived assets into `.data/wt-c3/` (override with `FOOTBALLOS_MEDIA_TEST_DIR`) on
first run: the synthetic game, a "held frame then play" clip (fixed-camera case), a "shaken"
clip (unstable-camera case) and an `-itsoffset 2.5 -c copy` copy of play-1 whose container
start time is 2.5 s. The demo documents (`fixtures/documents/README.md`) are regenerated into
`.data/wt-c3/documents/` on every run.

Milestone C additions: `documents.test.ts` (14 tests): the 3-page text PDF gives three
`pdf_text` pages at 935×1210 px with the heading, the numbered play list and every
"Term — definition" line; the image-only PDF gives `textSource: 'none'` / `ocrConfidence:
null` with the OCR-off warning, and `ocr` with confidence > 0.5 through the offline engine
when it is installed (the test checks `ocrAvailability()` and asserts the "engine not
available" warning otherwise); `.txt` paging 60/60/10 with exact line content; `.docx`
through mammoth; rejections (`unsupported_type`, `source_missing`, `invalid_pdf`,
`docx_failed`); an empty file; abort after page 1 removes the written image; `paginateText`
edge cases; the handler through `JobRunner` + `InMemoryJobStore` (result shape, files,
`pages.json`, no staging left), cancel mid-run leaving an empty `outDir`, non-retryable
input errors and a re-run that replaces the previous output as a unit.

Milestone B additions: `frames.test.ts` (1 fps over play-1 in reverse order comes back
ordered with exact `atSec`, 640x360 dimensions and `frameSec` within one frame period; no
upscaling; past-EOF timestamps are `missing`, not invented; duplicates and chunking; seek vs
full decode pick the identical frame (PSNR ∞); agreement with `thumbnailAt`; abort) and the
time-correctness test: frames read from the offset copy at `t` equal frames read from the
original at `toSourceSec(mapping, t)` (PSNR > 35 dB, equal `frameSec`), while reading the
copy at `t + 2.5` gives a different picture. `handlers.test.ts` runs `validate → proxy →
thumbnails → segment` on play-1 through `JobRunner` + `InMemoryJobStore`, checks result
shapes (segments through `PlaySegmentSchema`) and files on disk, the tile helpers in both
modes, rejection paths of `validate`, and a cancel mid-proxy (`preset: veryslow`) that leaves
neither `proxy.mp4` nor a `.part` file behind.

## Untested without a full game

- Running time and memory on a 90–180 minute 1080p file. The decode pass for segmentation
  is the dominant cost (one H.264 decode at full resolution; expect several minutes). The
  metadata text file for a 3-hour game at 4 fps is tens of megabytes; it is parsed once and
  deleted.
- Whether the adaptive thresholds separate plays from between-play activity on real
  sideline film where gaps are not black. The synthetic asset is an easy case.
- Proxy timing on variable-frame-rate or edit-list sources; only `durationDriftSec` would
  reveal a problem.
- 8 GB uploads and 4 h durations have only been exercised through unit tests of `validate`
  with substituted probe values, not with a real file of that size.
- HEVC and MKV inputs: accepted by `validate` but no fixture exists.
- `extractFrames` deep into a long file: the input seek lands on the previous keyframe and
  decodes forward, so cost per call is roughly one GOP plus the span between the first and
  last timestamp. Measured only on 6 s clips; not on a 3-hour file, and not with
  open-GOP/B-pyramid sources where the first frames after a seek can be undecodable (the
  one-second lead is the only margin).
- `extractFrames` timestamps that fall inside the last frame period, and very long requests
  (thousands of timestamps run in chunks of 240, one ffmpeg pass each).
- Handler running time and disk use for a full game: a kept frames directory is one JPEG
  per 10 s (about 1,100 files for three hours); `thumbTileJpeg` falls back to cropping the
  sheet if B deletes it.
- The proxy handler holds the encode in `proxy.mp4.part-<jobId>`; a worker killed with
  SIGKILL leaves that file until the next run of the same job (which rewrites it) or a host
  sweep of `*.part-*`.
- Documents: no password-protected PDF fixture exists (pdf-lib cannot encrypt), so the
  `PasswordException` branch is written from the pdfjs API and not exercised by a test. Large
  scanned PDFs (hundreds of pages) have not been timed; rendering is in-process and
  sequential. Text-page images use the system `monospace` face through @napi-rs/canvas: on a
  server without fonts the PNG would be blank while `text` stays correct. PDF text-layer
  order is pdfjs's content order, which can interleave columns on multi-column pages.

## Dependencies

| Package | Version | License | Why |
| --- | --- | --- | --- |
| ffmpeg-static | ^5.2.0 | GPL-3.0-or-later (binary, invoked as a separate process; see WORKFLOW.md) | proxies, thumbnails, statistics |
| ffprobe-static | ^3.1.0 | MIT (binary) | probing |
| zod | ^4.6.7 | MIT | option and limits schemas |
| @footballos/contracts | 0.1.0 (workspace) | MIT | record types (MediaAsset, ProcessingJob, PlaySegment, …) |
| pdfjs-dist | ^6.4.299 | Apache-2.0 | PDF page rendering and text layer (`legacy/build/pdf.mjs`; its `standard_fonts`, `cmaps`, `iccs`, `wasm` directories are read from disk) |
| @napi-rs/canvas | ^1.0.13 | MIT (prebuilt native binary per platform, optional dependency per target) | canvas for pdfjs rendering and text-page images; PNG encoding |
| tesseract.js | ^7.0.0 | Apache-2.0 | OCR engine (pulls `tesseract.js-core` ^7, Apache-2.0, the WASM build) |
| @tesseract.js-data/eng | ^1.0.0 | MIT (package); the traineddata inside is Apache-2.0 tessdata | English OCR model read offline from node_modules (13.9 MB unpacked; the 2.9 MB `4.0.0_best_int` file is used) |
| mammoth | ^1.13.0 | BSD-2-Clause | `.docx` → plain text |
| pdf-lib | ^1.17.1 (dev) | MIT | generates the PDF test fixtures |
| vitest, typescript, tsx, @types/node | dev | MIT / Apache-2.0 / MIT / MIT | tests, typecheck |
