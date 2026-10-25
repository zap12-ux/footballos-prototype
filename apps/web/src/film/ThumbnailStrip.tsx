import type { MediaGrantInfo } from '../api/api';
import { formatSeconds } from '../components/shell/ui';
import { thumbIndexFor, thumbUrl } from './review';

const TILES = 24;
export const ASSUMED_THUMB_EVERY_SEC = 10;

interface Props {
  grant: MediaGrantInfo;
  durationSec: number;
  currentTime: number;
  onSeek: (sec: number) => void;
}

/** Tiles from `thumbUrlTemplate` across the whole file; clicking one seeks the player. */
export function ThumbnailStrip({ grant, durationSec, currentTime, onSeek }: Props) {
  const everySec = grant.thumbEverySec ?? ASSUMED_THUMB_EVERY_SEC;
  const assumed = grant.thumbEverySec === undefined;
  const count = Math.max(1, Math.min(TILES, Math.floor(durationSec / everySec) || 1));
  const stride = durationSec / count;
  const activeTile = thumbIndexFor(currentTime, everySec);
  return (
    <div className="thumb-strip" aria-label="Thumbnails" role="group">
      <ul>
        {Array.from({ length: count }, (_, i) => {
          const atSec = Math.round(i * stride);
          const n = thumbIndexFor(atSec, everySec);
          const isActive = n === activeTile || (i < count - 1 && currentTime >= atSec && currentTime < (i + 1) * stride);
          return (
            <li key={i}>
              <button type="button" className={`thumb${isActive ? ' active' : ''}`} onClick={() => onSeek(atSec)} aria-current={isActive ? 'true' : undefined} title={`Seek to ${formatSeconds(atSec)}`}>
                <img src={thumbUrl(grant.thumbUrlTemplate, n)} alt="" width={96} height={54} loading="lazy" />
                <span className="mono small">{formatSeconds(atSec)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="small muted">
        One tile per {everySec} s of the original file{assumed ? ' (assumed: the grant did not state the tile interval)' : ''}; {count} shown.
      </p>
    </div>
  );
}
