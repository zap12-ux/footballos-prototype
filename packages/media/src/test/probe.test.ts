import { describe, expect, it } from 'vitest';
import { classifyContainer, DEFAULT_UPLOAD_LIMITS, probe, validate, type ProbeResult } from '../probe.ts';
import { CLIPS, SYNTHETIC_PATH, readManifest } from './fixtures.ts';

describe('probe on the six fixture clips', () => {
  for (const clip of CLIPS) {
    it(`reads container, codec, size, fps and duration of ${clip.split('/').pop()}`, async () => {
      const p = await probe(clip);
      expect(p.container).toBe('mp4');
      expect(p.videoCodec).toBe('h264');
      expect(p.width).toBe(1920);
      expect(p.height).toBe(1080);
      expect(p.fps).toBeCloseTo(29.97, 1);
      expect(p.durationSec).toBeGreaterThan(5);
      expect(p.durationSec).toBeLessThan(9);
      expect(p.rotation).toBe(0);
      expect(p.hasAudio).toBe(false);
      expect(p.byteSize).toBeGreaterThan(1_000_000);
      expect(p.videoStreamCount).toBe(1);
      expect(validate(p)).toEqual({ ok: true, reasons: [], warnings: [] });
    });
  }

  it('reports the container start offset separately from player time', async () => {
    const p = await probe(CLIPS[0] as string);
    expect(p.startTimeSec).toBeCloseTo(0.033, 3);
  });

  it('probes the synthetic asset at the length the manifest predicts', async () => {
    const m = await readManifest();
    const p = await probe(SYNTHETIC_PATH);
    expect(p.durationSec).not.toBeNull();
    expect(Math.abs((p.durationSec as number) - m.totalSec)).toBeLessThan(0.2);
  });
});

function fakeProbe(over: Partial<ProbeResult>): ProbeResult {
  return {
    path: 'x.mp4', byteSize: 1_000, container: 'mp4', formatName: 'mov,mp4,m4a,3gp,3g2,mj2', majorBrand: 'isom',
    durationSec: 3600, startTimeSec: 0, videoCodec: 'h264', videoProfile: 'High', audioCodec: null, hasAudio: false,
    width: 1920, height: 1080, fps: 29.97, rFrameRate: '30000/1001', rotation: 0, pixFmt: 'yuv420p', bitRate: null,
    nbFrames: null, videoStreamCount: 1, ...over,
  };
}

describe('validate against upload limits', () => {
  it('uses the owner-confirmed defaults', () => {
    expect(DEFAULT_UPLOAD_LIMITS.maxBytes).toBe(8 * 1024 ** 3);
    expect(DEFAULT_UPLOAD_LIMITS.maxDurationSec).toBe(4 * 3600);
    expect(DEFAULT_UPLOAD_LIMITS.allowedContainers).toEqual(['mp4', 'mov', 'mkv']);
    expect(DEFAULT_UPLOAD_LIMITS.allowedVideoCodecs).toEqual(['h264', 'hevc']);
  });

  it('rejects a file over the byte limit with a readable reason', () => {
    const r = validate(fakeProbe({ byteSize: 9 * 1024 ** 3 }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(['The file is 9.0 GB; the limit is 8.0 GB.']);
  });

  it('rejects over-long, wrong-codec, wrong-container and low-resolution files, each with its own reason', () => {
    const r = validate(fakeProbe({ durationSec: 5 * 3600, videoCodec: 'vp9', container: 'webm', formatName: 'matroska,webm', width: 640, height: 360 }));
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(4);
    expect(r.reasons.join(' ')).toContain('5 h 0 min');
    expect(r.reasons.join(' ')).toContain('vp9');
    expect(r.reasons.join(' ')).toContain('webm');
    expect(r.reasons.join(' ')).toContain('640x360');
  });

  it('rejects a file with no video stream', () => {
    const r = validate(fakeProbe({ videoCodec: null, videoStreamCount: 0, width: null, height: null }));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/no video stream/);
  });

  it('treats unknown duration as a rejection (unknown stays unknown, never a default)', () => {
    const r = validate(fakeProbe({ durationSec: null }));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/duration could not be determined/);
  });

  it('warns but accepts rotation flags, extra video streams and low frame rates', () => {
    const r = validate(fakeProbe({ rotation: 90, videoStreamCount: 2, fps: 15 }));
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(3);
  });

  it('accepts custom limits and refuses malformed ones', () => {
    const r = validate(fakeProbe({ container: 'webm', videoCodec: 'vp9' }), { ...DEFAULT_UPLOAD_LIMITS, allowedContainers: ['webm'], allowedVideoCodecs: ['vp9'] });
    expect(r.ok).toBe(true);
    expect(() => validate(fakeProbe({}), { ...DEFAULT_UPLOAD_LIMITS, maxBytes: -1 })).toThrow();
  });
});

describe('classifyContainer', () => {
  it('maps ffprobe format names to container families', () => {
    expect(classifyContainer('mov,mp4,m4a,3gp,3g2,mj2', 'isom')).toBe('mp4');
    expect(classifyContainer('mov,mp4,m4a,3gp,3g2,mj2', 'qt  ')).toBe('mov');
    expect(classifyContainer('matroska,webm', null)).toBe('mkv');
    expect(classifyContainer('avi', null)).toBe('avi');
    expect(classifyContainer('mpegts', null)).toBe('mpegts');
    expect(classifyContainer('flv', null)).toBe('other');
  });
});
