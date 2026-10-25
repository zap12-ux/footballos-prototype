import { describe, expect, it } from 'vitest';
import { probe } from '../probe.ts';
import { assessQuality, defaultWindows, interpretQuality, type QualityFrameSample } from '../quality.ts';
import { CLIPS, QUIET_THEN_PLAY_PATH, SHAKY_PATH, SYNTHETIC_PATH } from './fixtures.ts';

describe('defaultWindows', () => {
  it('uses the whole file when short and spreads windows otherwise', () => {
    expect(defaultWindows(6.4)).toEqual([{ fromSec: 0, toSec: 6.4 }]);
    const w = defaultWindows(3600, 5, 4);
    expect(w).toHaveLength(5);
    expect(w[0]!.fromSec).toBeCloseTo(72, 1);
    expect(w[4]!.toSec).toBeCloseTo(3528, 1);
    expect(w.every((x) => x.toSec - x.fromSec === 4)).toBe(true);
  });
});

describe('interpretQuality (pure)', () => {
  const baseProbe = async () => probe(CLIPS[0] as string);
  const frames = (n: number, f: (i: number) => Partial<QualityFrameSample>): QualityFrameSample[] =>
    Array.from({ length: n }, (_, i) => ({ atSec: i * 0.25, yavg: 90, ydif: 5, movingArea: 0.1, edgeDensity: 12, ...f(i) }));

  it('reports classes and leaves football questions null and listed as unevaluable', async () => {
    const q = interpretQuality(await baseProbe(), frames(40, () => ({})), [{ fromSec: 0, toSec: 10 }]);
    expect(q.resolutionClass).toBe('hd_1080');
    expect(q.fpsClass).toBe('standard');
    expect(q.quality.lineOfScrimmageVisible).toBeNull();
    expect(q.quality.allTwentyTwoVisible).toBeNull();
    expect(q.quality.unevaluable).toContain('line of scrimmage visibility');
    expect(q.quality.unevaluable).toContain('whether all 22 players are in frame');
    expect(q.exposure.class).toBe('normal');
    expect(q.quality.stable).toBeNull();
    expect(q.stability.estimate).toBe('unknown');
  });
  it('calls a camera unstable when most of the frame keeps changing', async () => {
    const q = interpretQuality(await baseProbe(), frames(40, () => ({ movingArea: 0.6 })), [{ fromSec: 0, toSec: 10 }]);
    expect(q.quality.stable).toBe(false);
    expect(q.stability.estimate).toBe('unstable');
  });
  it('calls a camera stable when quiet stretches exist, ignoring black frames', async () => {
    const q = interpretQuality(await baseProbe(), frames(40, (i) => (i < 12 ? { yavg: 2, movingArea: 0 } : i < 24 ? { movingArea: 0.005 } : {})), [{ fromSec: 0, toSec: 10 }]);
    expect(q.quality.stable).toBe(true);
    expect(q.exposure.blackFrameFraction).toBeCloseTo(0.3, 2);
    expect(q.quality.notes.some((n) => /30% of sampled frames are black/.test(n))).toBe(true);
  });
  it('flags dark footage and sd/low-fps classes', async () => {
    const p = { ...(await baseProbe()), width: 640, height: 480, fps: 15 };
    const q = interpretQuality(p, frames(40, () => ({ yavg: 30 })), [{ fromSec: 0, toSec: 10 }]);
    expect(q.resolutionClass).toBe('sd');
    expect(q.fpsClass).toBe('low');
    expect(q.exposure.class).toBe('dark');
    expect(q.quality.notes.join(' ')).toMatch(/Below 720p/);
  });
});

describe('assessQuality on fixtures (ffmpeg)', () => {
  it('on a mid-play clip reports hd_1080 and does not claim stability it cannot see', async () => {
    const q = await assessQuality(CLIPS[0] as string);
    expect(q.resolutionClass).toBe('hd_1080');
    expect(q.fpsClass).toBe('standard');
    expect(q.frameCount).toBeGreaterThan(10);
    expect(q.exposure.class).toBe('normal');
    expect(q.sharpness.edgeDensityMean).toBeGreaterThan(0);
    expect(q.quality.stable).toBeNull();
    expect(q.quality.unevaluable.some((u) => /camera stability/.test(u))).toBe(true);
  });
  it('recognises a held frame followed by a play as a fixed camera', async () => {
    const q = await assessQuality(QUIET_THEN_PLAY_PATH);
    expect(q.quality.stable).toBe(true);
    expect(q.stability.quietFrameFraction as number).toBeGreaterThan(0.15);
  });
  it('recognises a violently shaken copy of the same play as unstable', async () => {
    const q = await assessQuality(SHAKY_PATH);
    expect(q.quality.stable).toBe(false);
    expect(q.stability.movingAreaP90 as number).toBeGreaterThan(0.45);
  });
  it('samples five windows from the synthetic asset and sees its black gaps', async () => {
    const q = await assessQuality(SYNTHETIC_PATH);
    expect(q.windows).toHaveLength(5);
    expect(q.exposure.blackFrameFraction).not.toBeNull();
  });
});
