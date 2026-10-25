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

if (!command || !file || !['probe', 'validate', 'proxy', 'thumbs', 'frames', 'segments', 'quality'].includes(command)) {
  console.error('usage: media.mjs probe|validate|proxy|thumbs|frames|segments|quality <file> [out] [--height N] [--every N] [--fps N] [--at a,b,c]');
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
}
process.stderr.write(`done in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
