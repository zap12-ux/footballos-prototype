import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Ordered montage manifest (`public/montage/manifest.json`). Paths are relative to Vite's
 * `BASE_URL` unless absolute. The hero is source-agnostic: it plays whatever clips the
 * owner drops in; with no clips it shows the poster only.
 */
export interface MontageClip {
  src: string;
  poster?: string;
  credit?: string;
}

export interface MontageManifest {
  poster: string;
  clips: MontageClip[];
}

export function resolveAssetPath(path: string, baseUrl: string = import.meta.env.BASE_URL): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('/') || path.startsWith('data:') || path.startsWith('blob:')) return path;
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${path}`;
}

export const DEFAULT_MANIFEST: MontageManifest = { poster: 'montage/poster.svg', clips: [] };

function isManifest(value: unknown): value is MontageManifest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<MontageManifest>;
  return typeof v.poster === 'string' && Array.isArray(v.clips) && v.clips.every((c) => c && typeof c === 'object' && typeof (c as MontageClip).src === 'string');
}

/** Load the manifest; any failure falls back to the poster-only default. */
export function useMontageManifest(url: string = resolveAssetPath('montage/manifest.json')): MontageManifest {
  const [manifest, setManifest] = useState<MontageManifest>(DEFAULT_MANIFEST);
  useEffect(() => {
    let active = true;
    if (typeof fetch !== 'function') return undefined;
    (async () => {
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const json: unknown = await response.json();
        if (active && isManifest(json)) setManifest(json);
      } catch {
        /* poster-only fallback */
      }
    })();
    return () => {
      active = false;
    };
  }, [url]);
  return manifest;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface MontageProps {
  manifest: MontageManifest;
  label?: string;
  /** Shown under the frame when no clip carries its own credit. */
  caption?: ReactNode;
}

/**
 * Hero montage: one muted, inline video element that chains the manifest's clips and loops
 * the sequence. With `prefers-reduced-motion` only the poster is shown and nothing
 * autoplays; the coach can still start it. A visible control pauses and resumes. With an
 * empty clip list the poster is shown alone.
 */
export function Montage({ manifest, label = 'Football montage', caption }: MontageProps) {
  const reduced = useRef(prefersReducedMotion()).current;
  const clips = manifest.clips;
  const [playing, setPlaying] = useState(!reduced);
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const poster = resolveAssetPath(manifest.poster);
  const clip = clips[index % Math.max(clips.length, 1)];

  const safePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      const result = video.play() as unknown;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => setPlaying(false)); // autoplay blocked: say so truthfully
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

  const hasClips = clips.length > 0;
  const showVideo = hasClips && (!reduced || playing);
  const credit = clip?.credit ?? null;

  return (
    <figure className="montage" data-testid="montage">
      <div className="montage-frame">
        {showVideo && clip ? (
          <video
            ref={videoRef}
            key={clip.src}
            src={resolveAssetPath(clip.src)}
            poster={clip.poster ? resolveAssetPath(clip.poster) : poster}
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
        {hasClips ? (
          <button type="button" className="montage-control" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
            {playing ? 'Pause montage' : 'Play montage'}
          </button>
        ) : null}
        {hasClips && reduced ? (
          <span className="montage-note" data-testid="montage-reduced-motion">
            Reduced motion is on: the montage will not start on its own.
          </span>
        ) : null}
      </div>
      {credit || caption ? <figcaption className="montage-credit">{credit ?? caption}</figcaption> : null}
    </figure>
  );
}
