import type { FramePhase } from '../types';

/**
 * Real game footage used as the demo film. Six plays from Southwestern Oklahoma
 * State University's openly licensed end-zone game film, one per demo play, each
 * trimmed to a single snap (about six to nine seconds), re-encoded for the web, no
 * audio. The clips illustrate what a coach would be looking at; the simulated
 * evaluation describes the authored demo play, not the footage, and nothing in any
 * clip is analyzed.
 */
export const DEMO_FILM_CREDIT = {
  title: '11/06/2010 SWOSU vs UCO (endzone angle)',
  holder: 'Southwestern Oklahoma State University, SWOSU Football Videos',
  sourceUrl: 'https://dc.swosu.edu/football_vid/71',
  license: 'CC BY-NC 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  changes: 'six plays trimmed to one snap each, re-encoded for the web, audio removed',
} as const;

export interface DemoClip {
  /** URL of the clip, resolved against Vite's base so it works on GitHub Pages. */
  src: string;
  /**
   * Seek points, in seconds into the clip, for each storyboard phase. Set by
   * inspecting each clip frame by frame; they let the frame buttons scrub the real
   * footage to the matching moment of the snap.
   */
  phaseSeconds: Record<FramePhase, number>;
}

function clip(file: string, phaseSeconds: Record<FramePhase, number>): DemoClip {
  return { src: `${import.meta.env.BASE_URL}demo-film/${file}`, phaseSeconds };
}

/** One clip per authored demo play, keyed by play id. */
export const DEMO_FILM_CLIPS: Record<string, DemoClip> = {
  'play-1': clip('play-1.mp4', { presnap: 0.5, first_step: 2.1, contact: 2.7, result: 5.3 }),
  'play-2': clip('play-2.mp4', { presnap: 0.5, first_step: 3.4, contact: 3.9, result: 6.0 }),
  'play-3': clip('play-3.mp4', { presnap: 0.5, first_step: 3.1, contact: 3.6, result: 5.5 }),
  'play-4': clip('play-4.mp4', { presnap: 0.4, first_step: 2.1, contact: 2.6, result: 4.5 }),
  'play-5': clip('play-5.mp4', { presnap: 0.5, first_step: 2.6, contact: 3.1, result: 5.5 }),
  'play-6': clip('play-6.mp4', { presnap: 0.5, first_step: 2.1, contact: 2.6, result: 5.5 }),
};

/** The clip for a demo play; an unknown id falls back to the first clip. */
export function demoClipFor(playId: string): DemoClip {
  return DEMO_FILM_CLIPS[playId] ?? DEMO_FILM_CLIPS['play-1'];
}

/** Default clip URL (first play); the stage picks the per-play clip itself. */
export const DEMO_FILM_SRC = DEMO_FILM_CLIPS['play-1'].src;
