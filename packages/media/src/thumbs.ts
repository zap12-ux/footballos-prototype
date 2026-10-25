import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFfmpeg } from './ffmpeg.ts';
import type { ThumbnailSheetMapping } from './timemap.ts';

/**
 * Thumbnail tile access for the media routes (CONTRACTS §14.3:
 * `GET /media/:assetId/thumb/:n` serves tile n of the sheet, or a single frame file).
 *
 * `makeThumbnailSheet` writes a sidecar `<sheet>.json` next to the sheet with the
 * tile geometry, so a host that only stores the sheet path can still find tile n.
 */

export const THUMBNAIL_SIDECAR_VERSION = 1;

export interface ThumbnailSheetSidecar {
  version: number;
  mapping: ThumbnailSheetMapping;
  sheetWidth: number | null;
  sheetHeight: number | null;
  /** Directory holding `frame-00001.jpg` … (tile n is frame n+1) when frames were kept, else null. */
  framesDir: string | null;
}

export interface ThumbTile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function thumbnailSidecarPath(sheetPath: string): string {
  return `${sheetPath}.json`;
}

export async function writeThumbnailSidecar(sheetPath: string, sidecar: Omit<ThumbnailSheetSidecar, 'version'>): Promise<string> {
  const p = thumbnailSidecarPath(sheetPath);
  await writeFile(p, JSON.stringify({ version: THUMBNAIL_SIDECAR_VERSION, ...sidecar }, null, 2));
  return p;
}

export async function readThumbnailSidecar(sheetPath: string): Promise<ThumbnailSheetSidecar> {
  const p = thumbnailSidecarPath(sheetPath);
  let text: string;
  try {
    text = await readFile(p, 'utf8');
  } catch {
    throw new Error(`thumbnail sheet has no sidecar at ${p}; it was not produced by makeThumbnailSheet`);
  }
  const s = JSON.parse(text) as Partial<ThumbnailSheetSidecar>;
  if (s.version !== THUMBNAIL_SIDECAR_VERSION || !s.mapping) throw new Error(`unsupported thumbnail sidecar at ${p}`);
  return s as ThumbnailSheetSidecar;
}

/** Pixel rectangle of tile n (0-based) inside a mapping. Pure. */
export function thumbTileFromMapping(m: ThumbnailSheetMapping, n: number): ThumbTile {
  if (!Number.isInteger(n) || n < 0 || n >= m.count) throw new RangeError(`thumbnail index ${n} out of range 0..${m.count - 1}`);
  const col = n % m.columns;
  const row = Math.floor(n / m.columns);
  return { x: col * m.tileWidth, y: row * m.tileHeight, w: m.tileWidth, h: m.tileHeight };
}

/** Pixel rectangle of tile n inside the sheet at `sheetPath` (reads the sidecar). */
export async function thumbTile(sheetPath: string, n: number): Promise<ThumbTile> {
  const s = await readThumbnailSidecar(sheetPath);
  return thumbTileFromMapping(s.mapping, n);
}

/** Path of the single frame file for tile n when the frames were kept, else null. */
export async function thumbFramePath(sheetPath: string, n: number): Promise<string | null> {
  const s = await readThumbnailSidecar(sheetPath);
  thumbTileFromMapping(s.mapping, n); // range check
  if (!s.framesDir) return null;
  const p = join(s.framesDir, `frame-${String(n + 1).padStart(5, '0')}.jpg`);
  return existsSync(p) ? p : null;
}

/**
 * JPEG bytes for tile n as a standalone image: the kept frame file when it
 * exists, otherwise the tile cropped out of the sheet with ffmpeg. This is the
 * single-frame fallback behind `/media/:assetId/thumb/:n`.
 */
export async function thumbTileJpeg(sheetPath: string, n: number, opts: { signal?: AbortSignal; jpegQuality?: number } = {}): Promise<{ jpeg: Buffer; source: 'frame' | 'sheet_crop'; tile: ThumbTile }> {
  const s = await readThumbnailSidecar(sheetPath);
  const tile = thumbTileFromMapping(s.mapping, n);
  const frame = await thumbFramePath(sheetPath, n);
  if (frame) return { jpeg: await readFile(frame), source: 'frame', tile };
  const dir = await mkdtemp(join(tmpdir(), 'footballos-tile-'));
  try {
    const out = join(dir, 'tile.jpg');
    await runFfmpeg(
      ['-y', '-v', 'error', '-i', sheetPath, '-vf', `crop=${tile.w}:${tile.h}:${tile.x}:${tile.y}`, '-frames:v', '1', '-q:v', String(opts.jpegQuality ?? 3), '-f', 'image2', out],
      { signal: opts.signal },
    );
    return { jpeg: await readFile(out), source: 'sheet_crop', tile };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
