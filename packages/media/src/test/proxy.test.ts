import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { probe } from '../probe.ts';
import { makeProxy, makeThumbnailSheet, thumbnailAt } from '../proxy.ts';
import { sourceSecToThumbIndex, thumbIndexToSourceSec, thumbRect, toProxySec, toSourceSec } from '../timemap.ts';
import { CLIPS, DATA_DIR, readManifest, SYNTHETIC_PATH } from './fixtures.ts';

let out: string;
beforeAll(async () => {
  out = await mkdtemp(join(DATA_DIR, 'proxy-test-'));
});

describe('makeProxy', () => {
  it('produces a 720p h264 mp4 whose duration matches the source, with progress', async () => {
    const src = CLIPS[1] as string;
    const progress: number[] = [];
    const r = await makeProxy(src, join(out, 'play-2-proxy.mp4'), { onProgress: (p) => progress.push(p.fraction ?? -1) });
    expect(r.height).toBe(720);
    expect(r.width).toBe(1280);
    expect(r.byteSize).toBeGreaterThan(10_000);
    const p = await probe(r.path);
    expect(p.videoCodec).toBe('h264');
    expect(p.container).toBe('mp4');
    expect(r.durationDriftSec).not.toBeNull();
    expect(r.durationDriftSec as number).toBeLessThan(0.1);
    expect(r.mapping.proxyOffsetSec).toBe(0);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('does not upscale a source smaller than the requested height', async () => {
    const small = join(out, 'small-proxy.mp4');
    const first = await makeProxy(CLIPS[3] as string, small, { height: 360, preset: 'ultrafast' });
    expect(first.height).toBe(360);
    const r = await makeProxy(small, join(out, 'not-upscaled.mp4'), { height: 720, preset: 'ultrafast' });
    expect(r.height).toBe(360);
    expect(r.notes.some((n) => /keeps the source height/.test(n))).toBe(true);
  });

  it('can be aborted', async () => {
    const ctrl = new AbortController();
    const p = makeProxy(SYNTHETIC_PATH, join(out, 'aborted.mp4'), {
      preset: 'ultrafast',
      signal: ctrl.signal,
      onProgress: () => ctrl.abort(),
    });
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('thumbnails', () => {
  it('builds a sheet from the synthetic asset with an exact tile count and mapping', async () => {
    const m = await readManifest();
    const r = await makeThumbnailSheet(SYNTHETIC_PATH, join(out, 'sheet.jpg'), { everySec: 5, columns: 4, tileWidth: 160 });
    const expectedCount = Math.floor(m.totalSec / 5) + 1;
    expect(Math.abs(r.mapping.count - expectedCount)).toBeLessThanOrEqual(1);
    expect(r.mapping.columns).toBe(4);
    expect(r.mapping.rows).toBe(Math.ceil(r.mapping.count / 4));
    expect(r.sheetWidth).toBe(4 * r.mapping.tileWidth);
    expect(r.sheetHeight).toBe(r.mapping.rows * r.mapping.tileHeight);
    expect(r.mapping.tileWidth).toBe(160);
    expect(thumbIndexToSourceSec(r.mapping, 3)).toBe(15);
    expect(sourceSecToThumbIndex(r.mapping, 17.4)).toBe(3);
    expect(sourceSecToThumbIndex(r.mapping, 9999)).toBe(r.mapping.count - 1);
    expect(thumbRect(r.mapping, 5)).toEqual({ x: 160, y: r.mapping.tileHeight, width: 160, height: r.mapping.tileHeight });
    expect(r.framesDir).toBeNull();
  });

  it('keeps individual frames when asked', async () => {
    const r = await makeThumbnailSheet(CLIPS[2] as string, join(out, 'sheet-keep.jpg'), { everySec: 2, keepFrames: true });
    expect(r.framesDir).not.toBeNull();
    expect(r.mapping.count).toBeGreaterThanOrEqual(3);
  });

  it('thumbnailAt writes a frame at the requested time and clamps past the end', async () => {
    const src = CLIPS[0] as string;
    const r = await thumbnailAt(src, 2.5, join(out, 'at-2.5.jpg'), { width: 320 });
    expect(r.atSec).toBe(2.5);
    expect(r.width).toBe(320);
    const late = await thumbnailAt(src, 999, join(out, 'at-end.jpg'));
    expect(late.requestedAtSec).toBe(999);
    expect(late.atSec).toBeLessThan(6.4);
    expect(late.width).toBe(640);
  });
});

describe('time mapping helpers', () => {
  const m = { proxyOffsetSec: 0, sourceDurationSec: 100, proxyDurationSec: 100 };
  it('round-trips with a zero offset', () => {
    expect(toSourceSec(m, 12.5)).toBe(12.5);
    expect(toProxySec(m, 12.5)).toBe(12.5);
  });
  it('applies a non-zero offset and clamps', () => {
    const cut = { proxyOffsetSec: 30, sourceDurationSec: 100, proxyDurationSec: 70 };
    expect(toSourceSec(cut, 10)).toBe(40);
    expect(toProxySec(cut, 40)).toBe(10);
    expect(toProxySec(cut, 5)).toBe(0);
    expect(toSourceSec(cut, 500)).toBe(100);
  });
  it('rejects thumbnail indices out of range', () => {
    const tm = { everySec: 10, firstAtSec: 0, count: 3, columns: 3, rows: 1, tileWidth: 10, tileHeight: 5 };
    expect(() => thumbIndexToSourceSec(tm, 3)).toThrow(RangeError);
    expect(() => thumbRect(tm, -1)).toThrow(RangeError);
  });
});
