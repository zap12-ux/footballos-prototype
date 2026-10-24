import type { Play } from '../types';

/**
 * Real game footage used as the demo film. One run play from Southwestern Oklahoma
 * State University's openly licensed end-zone game film, trimmed to about six seconds,
 * re-encoded for the web, no audio. The clip is shown for every demo play as an
 * illustration of what a coach would be looking at; the simulated evaluation describes
 * the authored demo play, not this footage, and nothing in the clip is analyzed.
 */
export const DEMO_FILM_SRC = `${import.meta.env.BASE_URL}demo-film/swosu-2010-11-06-endzone-run.mp4`;

export const DEMO_FILM_CREDIT = {
  title: '11/06/2010 SWOSU vs UCO (endzone angle)',
  holder: 'Southwestern Oklahoma State University, SWOSU Football Videos',
  sourceUrl: 'https://dc.swosu.edu/football_vid/71',
  license: 'CC BY-NC 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
  changes: 'one run play trimmed to about six seconds, re-encoded for the web, audio removed',
} as const;

/**
 * Seek points, in seconds into the trimmed clip, for each storyboard phase. Set by
 * inspecting the clip frame by frame; they let the frame buttons scrub the real
 * footage to the matching moment of the run.
 */
export const DEMO_FILM_PHASE_SECONDS: Record<Play['storyboard'][number]['phase'], number> = {
  presnap: 0.5,
  first_step: 2.1,
  contact: 2.7,
  result: 5.3,
};
