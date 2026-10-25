# Brief C3 — Media / Document Processing Engineer, Milestone C (task C2-lib)

Read `COMMON.md` first, then `docs/team/CONTRACTS.md` **§15.1 and §15.5**, and
`packages/media/README.md`. Worktree: `/Users/zachariahparkhill/Projects/FootballOS/.worktrees/c3-media`,
branch `wt/c3-media`. Allowed paths: `packages/media/**`, `fixtures/documents/**`.
Scratch output: `.data/wt-c3`.

## Deliverables (commit a WIP after each)
1. `extractDocument(path, outDir, { renderDpi, ocr })` per §15.5 using `pdfjs-dist`
   (Apache-2.0) and `@napi-rs/canvas` (MIT) to render each page to PNG and read the PDF text
   layer per page (`textSource:'pdf_text'`), with per-page `width/height`; `.txt`/`.md`
   → pages of 60 lines; `.docx` via `mammoth` (BSD-2-Clause) only if it installs cleanly and
   the conversion is a few lines, else reject with a plain reason. Preserve the original
   page order and record `warnings[]` (encrypted PDF, no text layer, render failures).
2. OCR: try `tesseract.js` (Apache-2.0) **only if** its English language data can be installed
   from an npm package with an allowed license and used offline (check the package contents;
   no runtime download from a CDN is allowed). If that is not possible, implement
   `ocr:'off'` behaviour (scanned pages → `textSource:'none'`, `ocrConfidence:null`, warning
   "OCR engine not available") and say so in README. Never fabricate text.
3. `createDocumentHandlers({ dataDir })` → `{ extract_document }` with the §14.8 handler
   shape; honours `ctx.signal` and `ctx.progress`; writes `pages/page-<n>.png` and
   `pages.json` under `outDir`.
4. Fixtures: generate test documents in the test setup with `pdf-lib` (dev dependency, MIT):
   a 3-page text PDF with headings like "Inside Zone Right", a numbered play list and a
   "Terms" page with "Term — definition" lines; a 1-page image-only PDF (scanned stand-in);
   a `.txt`. Do not commit binaries larger than 200 KB; `fixtures/documents/README.md`
   explains how they are generated.
5. Tests: page count, image files exist with plausible dimensions, text per page, the
   image-only page yields `textSource:'none'`, `.txt` paging, abort mid-render leaves no
   partial output, handler result shape. Add `media.mjs doc <file> <outDir>` to the CLI.
6. Follow-up requested by B (Milestone B): add a proper `types` export (built `.d.ts`) to
   `packages/media/package.json` so the API no longer needs a `tsconfig` `paths` workaround;
   keep `exports["."]` working for Node and vitest.
7. README: new APIs, what OCR can and cannot do, dependency licenses.

## Acceptance (board C2-lib)
`npm run typecheck -w packages/media`, `npm test -w packages/media` green with the new tests;
signatures exactly as §15.5. List each new dependency with version and license.

## Owner question
Only if the OCR language-data question cannot be settled from package contents (ask
non-blocking: "allow an 11 MB English OCR data file vendored into the repo?").
