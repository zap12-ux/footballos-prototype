import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { MediaGrantInfo } from '../api/api';
import { describeError } from '../api/hooks';
import { formatSeconds } from '../components/shell/ui';
import type { SeekPlan } from './review';

export interface VideoPlayerHandle {
  /** Seek the media element to `mediaSec` (seconds in the served stream) and, by default, play. */
  seekTo(mediaSec: number, play?: boolean): void;
  currentTime(): number;
}

interface Props {
  grant: MediaGrantInfo | null;
  grantStatus: 'loading' | 'ready' | 'error' | 'idle';
  grantError: unknown;
  onRefreshGrant: () => void;
  /** Media-element time; the page maps it back to original-file time when a stand-in is playing. */
  onTimeUpdate: (mediaSec: number) => void;
  /** The served file's length once the element knows it (real proxies do not state it in the grant). */
  onDuration?: (sec: number) => void;
  /** The last seek the page resolved: stand-in mapping or an unavailable moment, said at the player. */
  notice: SeekPlan | null;
  label: string;
}

/**
 * The proxy player (§14.3). The source is the grant's `streamUrl`; when the element reports an
 * error (an expired token answers 401) a fresh grant is requested once, then the error is shown.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer({ grant, grantStatus, grantError, onRefreshGrant, onTimeUpdate, onDuration, notice, label }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const refreshed = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    seekTo(mediaSec, play = true) {
      const el = video.current;
      if (!el) return;
      el.currentTime = Math.max(0, mediaSec);
      if (!play) return;
      try {
        const started = el.play();
        if (started && typeof started.catch === 'function') started.catch(() => undefined);
      } catch {
        /* autoplay refused or no media implementation (tests): the coach presses play */
      }
    },
    currentTime: () => video.current?.currentTime ?? 0,
  }));

  if (grantStatus === 'error') {
    return (
      <div className="player player-empty" role="alert">
        <p>
          <strong>No playback grant.</strong> {describeError(grantError)}
        </p>
        <button type="button" onClick={onRefreshGrant}>
          Try again
        </button>
      </div>
    );
  }
  if (!grant) {
    return (
      <div className="player player-empty" role="status">
        {grantStatus === 'loading' ? 'Requesting a playback grant…' : 'Playback is available once the file has been validated.'}
      </div>
    );
  }
  return (
    <figure className="player">
      {/* Game film has no useful audio track and no captions; the segment list is the text alternative. */}
      <video
        ref={video}
        key={grant.streamUrl}
        src={grant.streamUrl}
        controls
        preload="metadata"
        playsInline
        aria-label={label}
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) onDuration?.(e.currentTarget.duration);
        }}
        onError={() => {
          if (refreshed.current !== grant.streamUrl) {
            refreshed.current = grant.streamUrl;
            onRefreshGrant();
            return;
          }
          setMediaError('The video could not be played. The grant was renewed once; the proxy file may be missing or still processing.');
        }}
      />
      <figcaption className="small muted">
        {notice?.kind === 'unavailable' ? (
          <span className="callout warn block" role="alert" data-testid="seek-notice">
            <strong>Not shown.</strong> {notice.message}
          </span>
        ) : notice?.kind === 'stand_in' ? (
          <span className="block" role="status" data-testid="seek-notice">
            {notice.message}
          </span>
        ) : grant.proxy?.standIn ? (
          <span className="block" data-testid="seek-notice">
            Stand-in proxy: a short clip stands in for the full game file. Select a play or follow an evidence link and the player says which moment it stands for.
          </span>
        ) : (
          `Proxy stream; grant renews before ${formatSeconds(Math.max(0, Math.round((Date.parse(grant.expiresAt) - Date.now()) / 1000)))} from now.`
        )}
        {mediaError ? (
          <span className="field-error" role="alert">
            {' '}
            {mediaError}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
});
