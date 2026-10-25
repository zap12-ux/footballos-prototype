#!/usr/bin/env node
// Manual-check CLI for @footballos/media. Runs the TypeScript sources directly
// (Node >= 23.6 strips types natively; on Node 22 run with --experimental-strip-types).
//
//   media.mjs probe <file>
//   media.mjs validate <file>
//   media.mjs proxy <file> [out.mp4] [--height 720]
//   media.mjs thumbs <file> [out.jpg] [--every 10]
//   media.mjs frames <file> <outDir> --at 1,2.5,40 [--height 720]
//   media.mjs segments <file> [--fps 4]
//   media.mjs quality <file>
//   media.mjs doc <file.pdf|.txt|.md|.docx> <outDir> [--dpi 110] [--ocr auto|off]
//   media.mjs doc-fixtures <outDir>        (writes the demo documents used by the tests)
import { resolve, basename } from 'node:path';

const [, , command, file, ...rest] = process.argv;

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= rest.length) return fallback;
  const v = Number(rest[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
function positional(i) {
  const args = rest.filter((a, idx) => !a.startsWith('--') && !(idx > 0 && rest[idx - 1].startsWith('--')));
  return args[i];
}

if (!command || !file || !['probe', 'validate', 'proxy', 'thumbs', 'frames', 'segments', 'quality', 'doc', 'doc-fixtures'].includes(command)) {
  console.error('usage: media.mjs probe|validate|proxy|thumbs|frames|segments|quality|doc <file> [out] [--height N] [--every N] [--fps N] [--at a,b,c] [--dpi N] [--ocr auto|off]\n       media.mjs doc-fixtures <outDir>');
  process.exit(2);
}

const media = await import('../src/index.ts');
const src = resolve(file);
const started = Date.now();
const print = (v) => console.log(JSON.stringify(v, null, 2));

switch (command) {
  case 'probe':
    print(await media.probe(src));
    break;
  case 'validate': {
    const p = await media.probe(src);
    print({ probe: p, validation: media.validate(p) });
    break;
  }
  case 'proxy': {
    const out = resolve(positional(0) ?? `${basename(src, '.mp4')}-proxy.mp4`);
    let last = -1;
    const r = await media.makeProxy(src, out, {
      height: flag('height', 720),
      onProgress: (p) => {
        const pct = p.fraction === null ? null : Math.floor(p.fraction * 10) * 10;
        if (pct !== null && pct !== last) {
          last = pct;
          process.stderr.write(`proxy ${pct}%\n`);
        }
      },
    });
    print(r);
    break;
  }
  case 'thumbs': {
    const out = resolve(positional(0) ?? `${basename(src, '.mp4')}-thumbs.jpg`);
    print(await media.makeThumbnailSheet(src, out, { everySec: flag('every', 10), keepFrames: rest.includes('--keep-frames') }));
    break;
  }
  case 'frames': {
    const outDir = resolve(positional(0) ?? `${basename(src, '.mp4')}-frames`);
    const i = rest.indexOf('--at');
    const at = i >= 0 && rest[i + 1] ? rest[i + 1].split(',').map(Number) : [0, 1, 2];
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(outDir, { recursive: true });
    const r = await media.extractFramesReport(src, at, { height: flag('height', 720) });
    for (const f of r.frames) await writeFile(resolve(outDir, `frame-${f.atSec.toFixed(3)}.jpg`), f.jpeg);
    print({ outDir, frames: r.frames.map(({ atSec, frameSec, width, height, jpeg }) => ({ atSec, frameSec, width, height, bytes: jpeg.length })), missing: r.missing, durationSec: r.durationSec });
    break;
  }
  case 'segments': {
    const r = await media.proposeSegments(src, { teamId: 'cli', assetId: basename(src), gameId: 'cli' }, { sampleFps: flag('fps', 4) });
    print({
      count: r.segments.length,
      confidenceNote: r.confidenceNote,
      thresholds: r.thresholds,
      segments: r.segments.map((s) => ({ index: s.index, startSec: s.startSec, endSec: s.endSec, lengthSec: Math.round((s.endSec - s.startSec) * 100) / 100 })),
      rawRuns: r.rawRuns,
      perSecondEnergy: r.series.perSecond.map((v) => Math.round(v * 10) / 10),
    });
    break;
  }
  case 'quality':
    print(await media.assessQuality(src));
    break;
  case 'doc': {
    const outDir = resolve(positional(0) ?? `${basename(src).replace(/\.[^.]+$/, '')}-pages`);
    const i = rest.indexOf('--ocr');
    const ocr = i >= 0 && rest[i + 1] === 'off' ? 'off' : 'auto';
    const r = await media.extractDocument(src, outDir, {
      renderDpi: flag('dpi', 110),
      ocr,
      onProgress: (done, total, message) => process.stderr.write(`${message}\n`),
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(resolve(outDir, media.PAGES_FILENAME), JSON.stringify({ version: 1, sourcePath: src, ...r, extractedAt: new Date().toISOString() }, null, 2));
    print({ outDir, ocrAvailability: media.ocrAvailability(), ...r, pages: r.pages.map((p) => ({ ...p, text: p.text === null ? null : `${p.text.slice(0, 160)}${p.text.length > 160 ? '…' : ''}` })) });
    break;
  }
  case 'doc-fixtures': {
    // `file` is the output directory for this command.
    const { ensureDocumentFixtures } = await import('../src/test/document-fixtures.ts');
    print(await ensureDocumentFixtures(src, { force: true }));
    break;
  }
}
process.stderr.write(`done in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
