import type { ChangeReasonCode, NoGradeReasonCode, ReasonCode } from '../types';

export const CHANGE_REASONS: { code: ChangeReasonCode; label: string }[] = [
  { code: 'alignment_stance', label: 'Alignment or stance' },
  { code: 'first_step', label: 'First-step direction' },
  { code: 'target_track', label: 'Target or track' },
  { code: 'hand_placement', label: 'Hand placement' },
  { code: 'pad_level', label: 'Pad level or leverage' },
  { code: 'combo_climb', label: 'Combo or climb timing' },
  { code: 'finish', label: 'Finish' },
  { code: 'ai_misread', label: 'AI misread the assignment' },
  { code: 'other', label: 'Other' },
];

export const NO_GRADE_REASONS: { code: NoGradeReasonCode; label: string }[] = [
  { code: 'not_visible', label: 'Player not visible' },
  { code: 'identity_unresolved', label: 'Cannot confirm it is No. 62' },
  { code: 'camera_angle', label: 'Camera angle insufficient' },
  { code: 'film_quality', label: 'Film quality too poor' },
  { code: 'assignment_unclear', label: 'Assignment unclear' },
  { code: 'context_missing', label: 'Play context missing' },
  { code: 'other', label: 'Other' },
];

const ALL: { code: ReasonCode; label: string }[] = [
  ...CHANGE_REASONS,
  ...NO_GRADE_REASONS,
];

export function reasonLabel(code: ReasonCode): string {
  return ALL.find((r) => r.code === code)?.label ?? code;
}

/**
 * Reason codes that describe the player's execution and can therefore drive a
 * practice focus. "AI misread the assignment" and "Other" describe the review,
 * not a player deficiency, and are logged but never turned into a teaching point.
 */
export const TEACHABLE_CODES: ChangeReasonCode[] = [
  'alignment_stance',
  'first_step',
  'target_track',
  'hand_placement',
  'pad_level',
  'combo_climb',
  'finish',
];

/**
 * Deterministic coaching copy for each teachable reason code.
 * Used to compose the simulated practice focus. Not authoritative coaching advice.
 */
export const REASON_COACHING: Record<
  ChangeReasonCode,
  { focusTitle: string; teachingCue: string; supportingPoints: string[] }
> = {
  alignment_stance: {
    focusTitle: 'Pre-snap alignment and stance consistency',
    teachingCue: 'Set the same stance depth and split every rep before the call.',
    supportingPoints: [
      'Walk-through alignment checks against the front before live reps.',
      'Hold stance for a two-count so the first step is not compromised.',
    ],
  },
  first_step: {
    focusTitle: 'First-step direction on Inside Zone Right',
    teachingCue: 'Play-side foot replaces the near foot of the defender, not the ground in front of you.',
    supportingPoints: [
      'Board drill emphasizing the first step before contact.',
      'Slow-motion film review of the first two frames after the snap.',
    ],
  },
  target_track: {
    focusTitle: 'Target and track through the zone track',
    teachingCue: 'Track the play-side number, not the defender’s original position.',
    supportingPoints: [
      'Chute work with a defined aiming point on each rep.',
      'Check the track against the running back’s landmark on film.',
    ],
  },
  hand_placement: {
    focusTitle: 'Hand placement during initial engagement',
    teachingCue: 'Win inside hand position before extending through contact.',
    supportingPoints: [
      'Hand-fit progression: fit, extend, finish — on air, then on a bag.',
      'Emphasize thumbs-up inside placement before the second step lands.',
    ],
  },
  pad_level: {
    focusTitle: 'Pad level and leverage at contact',
    teachingCue: 'Strike on the rise — hips below the shoulders through contact.',
    supportingPoints: [
      'Low-chute strike reps to reinforce leverage.',
      'Review the frame at contact for pad height on each graded snap.',
    ],
  },
  combo_climb: {
    focusTitle: 'Combo and climb timing',
    teachingCue: 'Stay on the double until the down lineman is moved, then climb late.',
    supportingPoints: [
      'Two-man combo reps with a coach calling the climb.',
      'Film check: was the down lineman displaced before the climb?',
    ],
  },
  finish: {
    focusTitle: 'Finishing the block through the whistle',
    teachingCue: 'Keep the feet running after contact until the whistle.',
    supportingPoints: [
      'Finish circuit after every team period.',
      'Review the last second of each clip, not just the point of contact.',
    ],
  },
  ai_misread: {
    focusTitle: 'Assignment clarity for this concept',
    teachingCue: 'Re-teach the play-side rules for Inside Zone Right before live reps.',
    supportingPoints: [
      'Walk through assignment rules against the fronts seen in this game.',
      'Confirm the terminology used in the rubric matches the room.',
    ],
  },
  other: {
    focusTitle: 'Coach-identified emphasis',
    teachingCue: 'Review the coach notes attached to the graded snaps.',
    supportingPoints: ['Use the recorded coaching notes to set the emphasis.'],
  },
};
