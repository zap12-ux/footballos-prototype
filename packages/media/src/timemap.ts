/**
 * Time mapping between derived media (proxy, thumbnails) and the original file.
 *
 * Convention (CONTRACTS §1): every stored time is seconds from the start of the
 * original uploaded file as a player shows it (first presented frame = 0). The
 * container start offset reported by ffprobe is kept in `ProbeResult.startTimeSec`
 * for anyone who needs container PTS; it is not part of this mapping.
 */

export interface ProxyTimeMapping {
  /** sourceSec = proxySec + proxyOffsetSec. 0 unless the proxy was cut with an in-point. */
  proxyOffsetSec: number;
  /** Source duration as probed, used to clamp. */
  sourceDurationSec: number | null;
  /** Proxy duration as probed after encoding. */
  proxyDurationSec: number | null;
}

export function toSourceSec(m: ProxyTimeMapping, proxySec: number): number {
  const t = proxySec + m.proxyOffsetSec;
  return clamp(t, 0, m.sourceDurationSec);
}

export function toProxySec(m: ProxyTimeMapping, sourceSec: number): number {
  const t = sourceSec - m.proxyOffsetSec;
  return clamp(t, 0, m.proxyDurationSec);
}

export interface ThumbnailSheetMapping {
  /** Seconds between thumbnails. */
  everySec: number;
  /** Source time of thumbnail 0 (the first sampled frame). */
  firstAtSec: number;
  /** Number of thumbnails actually extracted. */
  count: number;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/** Source seconds represented by thumbnail n (0-based). */
export function thumbIndexToSourceSec(m: ThumbnailSheetMapping, n: number): number {
  if (!Number.isInteger(n) || n < 0 || n >= m.count) throw new RangeError(`thumbnail index ${n} out of range 0..${m.count - 1}`);
  return m.firstAtSec + n * m.everySec;
}

/** Thumbnail index whose sampled time is nearest to `sourceSec` (clamped into range). */
export function sourceSecToThumbIndex(m: ThumbnailSheetMapping, sourceSec: number): number {
  if (m.count === 0) throw new RangeError('thumbnail sheet is empty');
  const n = Math.round((sourceSec - m.firstAtSec) / m.everySec);
  return Math.min(Math.max(n, 0), m.count - 1);
}

/** Pixel rectangle of thumbnail n inside the sheet. */
export function thumbRect(m: ThumbnailSheetMapping, n: number): { x: number; y: number; width: number; height: number } {
  if (!Number.isInteger(n) || n < 0 || n >= m.count) throw new RangeError(`thumbnail index ${n} out of range 0..${m.count - 1}`);
  const col = n % m.columns;
  const row = Math.floor(n / m.columns);
  return { x: col * m.tileWidth, y: row * m.tileHeight, width: m.tileWidth, height: m.tileHeight };
}

function clamp(t: number, lo: number, hi: number | null): number {
  if (t < lo) return lo;
  if (hi !== null && t > hi) return hi;
  return t;
}
