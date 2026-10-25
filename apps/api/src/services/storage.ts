import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';

/**
 * Private storage layout under FOOTBALLOS_DATA_DIR (CONTRACTS §14, brief B2 deliverable 2):
 *
 *   media/<teamId>/<assetId>/original.<ext>      the uploaded bytes, moved here at completion
 *   media/<teamId>/<assetId>/proxy.mp4           playback proxy (job `proxy`, @footballos/media PROXY_FILENAME)
 *   media/<teamId>/<assetId>/thumbs.jpg          thumbnail sheet (job `thumbnails`, THUMBNAIL_SHEET_FILENAME)
 *   media/<teamId>/<assetId>/thumbs.jpg.json     sheet sidecar (mapping) read by thumbTileJpeg
 *   media/<teamId>/<assetId>/thumbs.jpg.frames/frame-00001.jpg … individual tiles
 *   media/<teamId>/<assetId>/segments.json       the last segment proposal, for inspection
 *   uploads/<uploadId>.part                      partial uploads until completion or expiry
 *
 * Directories are created 0700 and files 0600: nothing under the data directory is ever
 * world-readable. Storage keys stored in the database are paths relative to the data directory.
 */

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

export function mediaRoot(config: AppConfig): string {
  return path.join(config.dataDir, 'media');
}

export function uploadsRoot(config: AppConfig): string {
  return path.join(config.dataDir, 'uploads');
}

export function ensureStorageDirs(config: AppConfig): void {
  for (const dir of [mediaRoot(config), uploadsRoot(config)]) {
    fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    try { fs.chmodSync(dir, DIR_MODE); } catch { /* best effort on exotic file systems */ }
  }
}

export function assetDirKey(teamId: string, assetId: string): string {
  return path.posix.join('media', teamId, assetId);
}

export function originalKey(teamId: string, assetId: string, ext: string): string {
  return path.posix.join(assetDirKey(teamId, assetId), `original.${ext}`);
}

export function proxyKey(teamId: string, assetId: string): string {
  return path.posix.join(assetDirKey(teamId, assetId), 'proxy.mp4');
}

/** Absolute path for a storage key; refuses keys that would escape the data directory. */
export function absolutePath(config: AppConfig, key: string): string {
  const abs = path.resolve(config.dataDir, key);
  const root = path.resolve(config.dataDir) + path.sep;
  if (!abs.startsWith(root)) throw new Error(`storage key escapes the data directory: ${key}`);
  return abs;
}

/** Converts an absolute path produced by a handler back into a storage key. */
export function keyFor(config: AppConfig, abs: string): string {
  const rel = path.relative(path.resolve(config.dataDir), path.resolve(abs));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path is outside the data directory: ${abs}`);
  return rel.split(path.sep).join('/');
}

export function partPath(config: AppConfig, uploadId: string): string {
  return path.join(uploadsRoot(config), `${uploadId}.part`);
}

export function ensureAssetDir(config: AppConfig, teamId: string, assetId: string): string {
  const dir = absolutePath(config, assetDirKey(teamId, assetId));
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  return dir;
}

/** Creates an empty, owner-only file (truncating any previous content). */
export function createPrivateFile(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const fd = fs.openSync(file, 'w', FILE_MODE);
  fs.closeSync(fd);
  try { fs.chmodSync(file, FILE_MODE); } catch { /* ignore */ }
}

export function removeQuietly(target: string): void {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Makes every file in an asset directory owner-only (handlers write with the process umask). */
export function tightenPermissions(dir: string): void {
  if (!fs.existsSync(dir)) return;
  try { fs.chmodSync(dir, DIR_MODE); } catch { /* ignore */ }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) tightenPermissions(p);
    else { try { fs.chmodSync(p, FILE_MODE); } catch { /* ignore */ } }
  }
}

/** File extension for the stored original: lower-case, alphanumeric, at most 8 characters, from the client filename. */
export function extensionOf(filename: string): string | null {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : null;
}
