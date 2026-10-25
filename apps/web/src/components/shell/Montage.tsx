import { useCallback, useEffect, useRef, useState } from 'react';

export interface MontageProps {
  /** Clip URLs played in order, then repeated. */
  clips: string[];
  poster: string;
  /** Visible credit line (licence requirement). */
  credit: React.ReactNode;
  label?: string;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Hero montage: one muted, inline video element that chains the credited clips and loops
 * the sequence. With `prefers-reduced-motion` only the poster is shown and nothing
 * autoplays; the coach can still start it. A visible control pauses and resumes.
 */
export function Montage({ clips, poster, credit, label = 'Football montage' }: MontageProps) {
  const reduced = useRef(prefersReducedMotion()).current;
  const [playing, setPlaying] = useState(!reduced);
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const result = video.play() as unknown;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => setPlaying(false)); // autoplay blocked: show the control state truthfully
      }
    } catch {
      setPlaying(false);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) safePlay();
    else {
      try {
        video.pause();
      } catch {
        /* jsdom */
      }
    }
  }, [playing, index, safePlay]);

  const showVideo = !reduced || playing;

  return (
    <figure className="montage">
      <div className="montage-frame">
        {showVideo ? (
          <video
            ref={videoRef}
            key={clips[index]}
            src={clips[index]}
            poster={poster}
            muted
            playsInline
            loop={clips.length === 1}
            autoPlay={!reduced}
            preload="metadata"
            aria-label={label}
            data-testid="montage-video"
            onEnded={() => setIndex((i) => (i + 1) % clips.length)}
          />
        ) : (
          <img src={poster} alt="" className="montage-poster" data-testid="montage-poster" />
        )}
        <button type="button" className="montage-control" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? 'Pause montage' : 'Play montage'}
        </button>
        {reduced ? (
          <span className="montage-note" data-testid="montage-reduced-motion">
            Reduced motion is on: the montage will not start on its own.
          </span>
        ) : null}
      </div>
      <figcaption className="montage-credit">{credit}</figcaption>
    </figure>
  );
}
