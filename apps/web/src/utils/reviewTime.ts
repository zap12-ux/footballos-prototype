import type { ReviewInterval, SessionState } from '../types';

/**
 * Accumulated review time.
 *
 * A review interval starts when the play-review screen opens for a play while the tab is
 * visible, and ends when the coach leaves the screen, the tab is hidden, or the page goes
 * away. Intervals never overlap because only one play can be open at a time. Reopening a
 * play adds a new interval; nothing already recorded is removed. Saving a decision, picking
 * a reason, or saving again does not start or end an interval, so repeated saves cannot
 * double-count time.
 */

export function closedSecondsForPlay(intervals: ReviewInterval[], playId: string): number {
  let ms = 0;
  for (const i of intervals) {
    if (i.playId === playId && i.endMs > i.startMs) ms += i.endMs - i.startMs;
  }
  return ms / 1000;
}

/** Seconds spent on a play so far, including the interval that is open right now. */
export function accumulatedSecondsForPlay(
  state: Pick<SessionState, 'reviewIntervals' | 'openReview'>,
  playId: string,
  nowMs: number = Date.now(),
): number {
  let seconds = closedSecondsForPlay(state.reviewIntervals, playId);
  if (state.openReview && state.openReview.playId === playId) {
    seconds += Math.max(0, nowMs - state.openReview.startMs) / 1000;
  }
  return Math.round(seconds);
}

/** Seconds per play across the whole session (closed intervals only). */
export function secondsByPlay(intervals: ReviewInterval[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of intervals) {
    if (i.endMs <= i.startMs) continue;
    out[i.playId] = (out[i.playId] ?? 0) + (i.endMs - i.startMs) / 1000;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

export function totalReviewSeconds(intervals: ReviewInterval[]): number {
  return Object.values(secondsByPlay(intervals)).reduce((a, b) => a + b, 0);
}
