import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runFfmpeg } from '../ffmpeg.ts';
import { extractFrames, extractFramesReport, jpegDimensions, parseShowinfoTimes } from '../frames.ts';
import { probe } from '../probe.ts';
import { thumbnailAt } from '../proxy.ts';
import { toSourceSec, type ProxyTimeMapping } from '../timemap.ts';
import { CLIPS, DATA_DIR } from './fixtures.ts';

const PLAY1 = CLIPS[0] as string;

/** Peak signal-to-noise ratio between two JPEGs via ffmpeg's psnr filter; Infinity for identical pictures. */
async function psnr(a: Buffer | string, b: Buffer | string): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), 'footballos-psnr-'));
  try {
    const pa = typeof a === 'string' ? a : join(dir, 'a.jpg');
    const pb = typeof b === 'string' ? b : join(dir, 'b.jpg');
    if (typeof a !== 'string') await writeFile(pa, a);
    if (typeof b !== 'string') await writeFile(pb, b);
    const { stderr } = await runFfmpeg(['-v', 'info', '-i', pa, '-i', pb, '-lavfi', 'psnr', '-f', 'null', '-']);
    const m = /average:(inf|[0-9.]+)/.exec(stderr);
    if (!m) throw new Error(`psnr not found in: ${stderr.slice(-400)}`);
    return m[1] === 'inf' ? Number.POSITIVE_INFINITY : Number.parseFloat(m[1] as string);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('extractFrames on play-1 (ffmpeg)', () => {
  it('returns one frame per second, ordered, with dimensions and an exact atSec echo', async () => {
    const p = await probe(PLAY1);
    const duration = p.durationSec as number;
    const stamps = [];
    for (let t = 0; t < duration; t += 1) stamps.push(t);
    const shuffled = [...stamps].reverse();
    const frames = await extractFrames(PLAY1, shuffled, { height: 360 });
    expect(frames.map((f) => f.atSec)).toEqual(stamps);
    for (const f of frames) {
      expect(f.jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(f.height).toBe(360);
      expect(f.width).toBe(640);
      expect(f.frameSec).toBeGreaterThanOrEqual(f.atSec);
      expect(f.frameSec - f.atSec).toBeLessThan(1 / (p.fps as number) + 1e-3);
    }
    // consecutive frames are different pictures
    expect(await psnr((frames[1] as { jpeg: Buffer }).jpeg, (frames[2] as { jpeg: Buffer }).jpeg)).toBeLessThan(30);
  });

  it('never upscales and honours the quality option', async () => {
    const [a] = await extractFrames(PLAY1, [1], { height: 2160, quality: 2 });
    const [b] = await extractFrames(PLAY1, [1], { height: 2160, quality: 31 });
    expect(a?.height).toBe(1080);
    expect(a?.width).toBe(1920);
    expect((a as { jpeg: Buffer }).jpeg.length).toBeGreaterThan((b as { jpeg: Buffer }).jpeg.length);
  });

  it('timestamps at or past the end of the stream are reported as missing, not invented', async () => {
    const p = await probe(PLAY1);
    const duration = p.durationSec as number;
    const r = await extractFramesReport(PLAY1, [duration - 0.5, duration + 0.5, duration + 10, 1], { height: 240 });
    expect(r.frames.map((f) => f.atSec)).toEqual([1, duration - 0.5]);
    expect(r.missing).toEqual([duration + 0.5, duration + 10]);
    expect(await extractFrames(PLAY1, [duration + 1])).toEqual([]);
  });

  it('collapses duplicate timestamps, chunks long requests and rejects bad input', async () => {
    const frames = await extractFrames(PLAY1, [2, 2, 0.5, 2.0, 0.5, 3, 4, 5], { height: 240, maxPerInvocation: 3 });
    expect(frames.map((f) => f.atSec)).toEqual([0.5, 2, 3, 4, 5]);
    await expect(extractFrames(PLAY1, [-1])).rejects.toThrow(RangeError);
    await expect(extractFrames(PLAY1, [Number.NaN])).rejects.toThrow(RangeError);
    expect(await extractFrames(PLAY1, [])).toEqual([]);
  });

  it('seeking and decoding from the start pick the same frame', async () => {
    const [seeked] = await extractFrames(PLAY1, [4.2], { height: 360 });
    const [full] = await extractFrames(PLAY1, [4.2], { height: 360, seek: false });
    expect(seeked?.frameSec).toBe(full?.frameSec);
    expect(await psnr((seeked as { jpeg: Buffer }).jpeg, (full as { jpeg: Buffer }).jpeg)).toBe(Number.POSITIVE_INFINITY);
  });

  it('agrees with thumbnailAt (Milestone A, -ss input seek) on the picture at a given time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'footballos-frames-test-'));
    try {
      const [f] = await extractFrames(PLAY1, [3], { height: 360 });
      const t = await thumbnailAt(PLAY1, 3, join(dir, 'thumb.jpg'), { width: 640 });
      expect(t.width).toBe(f?.width);
      expect(await psnr((f as { jpeg: Buffer }).jpeg, t.path)).toBeGreaterThan(35);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('can be aborted', async () => {
    const ctrl = new AbortController();
    const p = extractFrames(PLAY1, [0, 1, 2, 3, 4, 5], { height: 1080, seek: false, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 50);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('time correctness with a non-zero container start offset', () => {
  const OFFSET_SEC = 2.5;
  const offsetPath = join(DATA_DIR, 'play-1-itsoffset-2500ms.mp4');

  async function ensureOffsetCopy(): Promise<string> {
    if (existsSync(offsetPath)) return offsetPath;
    await mkdir(DATA_DIR, { recursive: true });
    // Same frames, container start offset moved to 2.5 s (edit list); what a proxy written
    // with -copyts or a camera file with a late first packet looks like.
    await runFfmpeg(['-y', '-v', 'error', '-itsoffset', String(OFFSET_SEC), '-i', PLAY1, '-c', 'copy', offsetPath]);
    return offsetPath;
  }

  it('extractFrames timestamps map back through toSourceSec for a proxy with startTimeSec > 0', async () => {
    const proxyLike = await ensureOffsetCopy();
    const original = await probe(PLAY1);
    const shifted = await probe(proxyLike);
    expect(shifted.startTimeSec).toBeCloseTo(OFFSET_SEC, 2);
    expect(shifted.nbFrames).toBe(original.nbFrames);
    // The player clock starts at the first presented frame regardless of the container
    // offset, so the mapping is identity (proxyOffsetSec 0), as makeProxy records it.
    const mapping: ProxyTimeMapping = { proxyOffsetSec: 0, sourceDurationSec: original.durationSec, proxyDurationSec: shifted.durationSec };

    const proxyTimes = [1, 3.5, 5];
    const proxyFrames = await extractFrames(proxyLike, proxyTimes, { height: 360 });
    expect(proxyFrames.map((f) => f.atSec)).toEqual(proxyTimes);
    const sourceFrames = await extractFrames(PLAY1, proxyTimes.map((t) => toSourceSec(mapping, t)), { height: 360 });
    for (let i = 0; i < proxyTimes.length; i++) {
      const a = proxyFrames[i] as { jpeg: Buffer; frameSec: number };
      const b = sourceFrames[i] as { jpeg: Buffer; frameSec: number };
      expect(a.frameSec).toBeCloseTo(b.frameSec, 3);
      expect(await psnr(a.jpeg, b.jpeg)).toBeGreaterThan(35);
    }
    // Control: reading the proxy at a time shifted by the container offset gives a different picture.
    const [wrong] = await extractFrames(proxyLike, [3.5 + OFFSET_SEC], { height: 360 });
    expect(await psnr((wrong as { jpeg: Buffer }).jpeg, (sourceFrames[1] as { jpeg: Buffer }).jpeg)).toBeLessThan(30);
  });
});

describe('pure helpers', () => {
  it('parseShowinfoTimes reads pts_time from showinfo lines only', () => {
    const text = [
      '[Parsed_showinfo_1 @ 0x1] n:   0 pts:  90090 pts_time:3.003   duration: 1001 duration_time:0.0333667 fmt:yuv420p',
      '[Parsed_showinfo_1 @ 0x1] n:   1 pts: 156156 pts_time:5.2052  duration: 1001',
      'Output #0, image2, to ...',
      '[something else] pts_time:9.9',
    ].join('\n');
    expect(parseShowinfoTimes(text)).toEqual([3.003, 5.2052]);
  });

  it('jpegDimensions reads the SOF marker', () => {
    const sof = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x68, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
    expect(jpegDimensions(sof)).toEqual({ width: 640, height: 360 });
    expect(() => jpegDimensions(Buffer.from([0, 1, 2]))).toThrow();
  });
});
