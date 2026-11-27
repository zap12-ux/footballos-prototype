import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFfmpeg } from '../ffmpeg.ts';
import { probe } from '../probe.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../../..');
export const DEMO_FILM_DIR = join(REPO_ROOT, 'fixtures/media/clips');
export const DATA_DIR = join(REPO_ROOT, process.env['FOOTBALLOS_MEDIA_TEST_DIR'] ?? '.data/wt-c3');
export const CLIPS = [1, 2, 3, 4, 5, 6].map((n) => join(DEMO_FILM_DIR, `play-${n}.mp4`));

export const SYNTHETIC_PATH = join(DATA_DIR, 'synthetic-game.mp4');
export const SYNTHETIC_MANIFEST_PATH = join(DATA_DIR, 'synthetic-game.json');
export const QUIET_THEN_PLAY_PATH = join(DATA_DIR, 'quiet-then-play.mp4');
export const SHAKY_PATH = join(DATA_DIR, 'shaky-play.mp4');

/** Black gaps (seconds) placed before play 1, between plays, and after play 6. */
export const GAPS = [3, 4, 5, 3, 4, 5, 3];
const SYNTHETIC_VERSION = 'v2:concat-black-ultrafast-crf28';

export interface SyntheticManifest {
  version: string;
  gaps: number[];
  plays: Array<{ clip: string; startSec: number; endSec: number; durationSec: number }>;
  totalSec: number;
}

function black(d: number): string[] {
  return ['-f', 'lavfi', '-i', `color=c=black:s=1920x1080:r=30000/1001:d=${d}`];
}

/** Six real clips with black between them. Cached in .data/wt-c; rebuilt when missing or the manifest version changes. */
export async function ensureSyntheticAsset(): Promise<SyntheticManifest> {
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(SYNTHETIC_PATH) && existsSync(SYNTHETIC_MANIFEST_PATH)) {
    const m = JSON.parse(await readFile(SYNTHETIC_MANIFEST_PATH, 'utf8')) as Partial<SyntheticManifest>;
    if (m.version === SYNTHETIC_VERSION) return m as SyntheticManifest;
  }
  const durations: number[] = [];
  for (const c of CLIPS) {
    const p = await probe(c);
    if (p.durationSec === null) throw new Error(`fixture ${c} has no duration`);
    durations.push(p.durationSec);
  }
  const plays: SyntheticManifest['plays'] = [];
  let t = 0;
  for (let i = 0; i < CLIPS.length; i++) {
    t += GAPS[i] as number;
    const d = durations[i] as number;
    plays.push({ clip: CLIPS[i] as string, startSec: round3(t), endSec: round3(t + d), durationSec: d });
    t += d;
  }
  t += GAPS[GAPS.length - 1] as number;

  // Inputs 0..5 are the clips; 6..12 are the black generators, one per gap.
  const inputs = CLIPS.flatMap((c) => ['-i', c]).concat(GAPS.flatMap((g) => black(g)));
  const order: string[] = [];
  for (let i = 0; i < CLIPS.length; i++) order.push(`[${6 + i}:v]`, `[${i}:v]`);
  order.push(`[${6 + CLIPS.length}:v]`);
  const graph = `${order.join('')}concat=n=${order.length}:v=1:a=0,format=yuv420p[v]`;
  await runFfmpeg([
    '-y', '-v', 'error', ...inputs,
    '-filter_complex', graph, '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-movflags', '+faststart',
    SYNTHETIC_PATH,
  ]);
  const manifest: SyntheticManifest = { version: SYNTHETIC_VERSION, gaps: GAPS, plays, totalSec: round3(t) };
  await writeFile(SYNTHETIC_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  return manifest;
}

/** 6 s of a held frame (what a fixed camera shows between plays) followed by play-1. */
export async function ensureQuietThenPlay(): Promise<string> {
  if (existsSync(QUIET_THEN_PLAY_PATH)) return QUIET_THEN_PLAY_PATH;
  await mkdir(DATA_DIR, { recursive: true });
  const src = CLIPS[0] as string;
  await runFfmpeg([
    '-y', '-v', 'error',
    '-i', src, '-i', src,
    '-filter_complex',
    '[0:v]trim=start_frame=0:end_frame=1,setpts=PTS-STARTPTS,loop=loop=179:size=1:start=0,setpts=N/(30000/1001)/TB[still];[still][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', QUIET_THEN_PLAY_PATH,
  ]);
  return QUIET_THEN_PLAY_PATH;
}

/** play-1 re-cropped with a large, fast jitter: a stand-in for a badly shaken handheld camera. */
export async function ensureShaky(): Promise<string> {
  if (existsSync(SHAKY_PATH)) return SHAKY_PATH;
  await mkdir(DATA_DIR, { recursive: true });
  await runFfmpeg([
    '-y', '-v', 'error', '-i', CLIPS[0] as string,
    '-vf', "crop=1600:900:'160+150*sin(t*20)':'90+80*cos(t*23)'",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', SHAKY_PATH,
  ]);
  return SHAKY_PATH;
}

export async function readManifest(): Promise<SyntheticManifest> {
  return JSON.parse(await readFile(SYNTHETIC_MANIFEST_PATH, 'utf8')) as SyntheticManifest;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Generated demo documents (see `document-fixtures.ts`). */
export const DOCUMENTS_DIR = join(DATA_DIR, 'documents');
