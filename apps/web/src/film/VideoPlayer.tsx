import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { MediaGrantInfo } from '../api/api';
import { describeError } from '../api/hooks';
import { formatSeconds } from '../components/shell/ui';

export interface VideoPlayerHandle {
  /** Seek to a time in seconds from the start of the original file and start playing. */
  seekTo(sec: number): void;
  currentTime(): number;
}

interface Props {
  grant: MediaGrantInfo | null;
  grantStatus: 'loading' | 'ready' | 'error' | 'idle';
  grantError: unknown;
  onRefreshGrant: () => void;
  onTimeUpdate: (sec: number) => void;
  demo: boolean;
  label: string;
}

/**
 * The proxy player (§14.3). The source is the grant's `streamUrl`; when the element reports an
 * error (an expired token answers 401) a fresh grant is requested once, then the error is shown.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer({ grant, grantStatus, grantError, onRefreshGrant, onTimeUpdate, demo, label }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const refreshed = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    seekTo(sec) {
      const el = video.current;
      if (!el) return;
      el.currentTime = Math.max(0, sec);
      void el.play().catch(() => undefined);
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
        {demo ? 'Demo proxy: a short credited clip stands in for the full game file; times on this page still refer to the original upload.' : `Proxy stream; grant renews before ${formatSeconds(Math.max(0, Math.round((Date.parse(grant.expiresAt) - Date.now()) / 1000)))} from now.`}
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
