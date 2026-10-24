import { PLAYS } from '../data/plays';
import { reasonLabel } from '../data/reasons';
import { ACCURACY_STATEMENT, CONFIDENCE_DISCLAIMER } from '../data/team';
import type { CoachDecision, GradeValue, ReasonCode, SessionState } from '../types';
import { buildPracticeFocus } from './recommendation';

/**
 * Exactly what each timing measure includes. Shown in the UI and written to the export
 * so a reader never has to guess what was compared.
 */
export const TIMING_DEFINITIONS = {
  baselineMinutes:
    'Self-reported, captured on the introduction screen before any exposure to the review workflow: the minutes the coach says it normally takes to grade six comparable offensive-line snaps.',
  measuredReviewMinutes:
    'Sum, across reviewed plays, of the seconds from the most recent opening of a play to its most recent recorded decision. Excludes time on the introduction, team context, film, queue, practice focus and feedback screens. Reopening a play restarts its clock.',
  sessionElapsedMinutes:
    'Wall-clock minutes from "Begin Review" to now, including every screen and any idle time.',
  illustrativeDifferenceMinutes:
    'Baseline minutes minus measured review minutes. Computed only when all six plays have a decision. An illustrative comparison against a self-reported estimate — not a measured productivity improvement.',
} as const;

export interface SessionSummary {
  playsReviewed: number;
  playsTotal: number;
  playsGraded: number;
  playsNoGrade: number;
  accepted: number;
  changed: number;
  coachNoGrade: number;
  changeReasonBreakdown: { code: ReasonCode; label: string; count: number }[];
  noGradeReasonBreakdown: { code: ReasonCode; label: string; count: number }[];
  blindComparison: {
    playNumber: number;
    blindGrade: GradeValue | null;
    candidateGrade: GradeValue;
    finalGrade: GradeValue | null;
    movedTowardCandidate: boolean | null;
  } | null;
  averageReviewSeconds: number;
  measuredReviewMinutes: number;
  sessionElapsedMinutes: number | null;
  baselineMinutes: number | null;
  baselineRevisedMinutes: number | null;
  comparison: {
    comparable: boolean;
    reason: string;
    illustrativeDifferenceMinutes: number | null;
  };
  trustRating: number | null;
}

function tally(codes: ReasonCode[]) {
  const map = new Map<ReasonCode, number>();
  for (const c of codes) map.set(c, (map.get(c) ?? 0) + 1);
  return [...map.entries()]
    .map(([code, count]) => ({ code, label: reasonLabel(code), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildSummary(state: SessionState, now: number = Date.now()): SessionSummary {
  const decisions = Object.values(state.decisions) as CoachDecision[];
  const graded = decisions.filter((d) => d.finalGrade !== 'NG');
  const noGrade = decisions.filter((d) => d.finalGrade === 'NG');
  const accepted = decisions.filter((d) => d.action === 'accepted');
  const changed = decisions.filter((d) => d.action === 'changed');
  const coachNoGrade = decisions.filter((d) => d.action === 'no_grade');

  const totalSeconds = decisions.reduce((sum, d) => sum + d.reviewSeconds, 0);
  const averageReviewSeconds = decisions.length
    ? Math.round(totalSeconds / decisions.length)
    : 0;
  const measuredReviewMinutes = Math.round((totalSeconds / 60) * 10) / 10;
  const sessionElapsedMinutes = state.startedAtMs
    ? Math.round(((now - state.startedAtMs) / 60000) * 10) / 10
    : null;

  const blindPlay = PLAYS.find((p) => p.blindFirst) ?? null;
  const blindDecision = blindPlay ? state.decisions[blindPlay.id] : undefined;
  const blindComparison = blindPlay
    ? {
        playNumber: blindPlay.playNumber,
        blindGrade: state.blindGrades[blindPlay.id] ?? null,
        candidateGrade: blindPlay.candidateGrade,
        finalGrade: blindDecision ? blindDecision.finalGrade : null,
        movedTowardCandidate: blindDecision?.movedTowardCandidate ?? null,
      }
    : null;

  const baselineMinutes = state.baseline?.minutesForSixSnaps ?? null;
  const baselineRevisedMinutes = state.baselineRevision?.minutesForSixSnaps ?? null;
  const complete = decisions.length === PLAYS.length;

  let comparison: SessionSummary['comparison'];
  if (baselineMinutes === null) {
    comparison = { comparable: false, reason: 'No baseline was captured.', illustrativeDifferenceMinutes: null };
  } else if (!complete) {
    comparison = {
      comparable: false,
      reason: `Not comparable: ${decisions.length} of ${PLAYS.length} plays have a decision. The baseline describes six snaps, so a partial session is not compared.`,
      illustrativeDifferenceMinutes: null,
    };
  } else {
    comparison = {
      comparable: true,
      reason:
        'Illustrative comparison against a self-reported baseline. Not a measured productivity improvement.',
      illustrativeDifferenceMinutes:
        Math.round((baselineMinutes - measuredReviewMinutes) * 10) / 10,
    };
  }

  return {
    playsReviewed: decisions.length,
    playsTotal: PLAYS.length,
    playsGraded: graded.length,
    playsNoGrade: noGrade.length,
    accepted: accepted.length,
    changed: changed.length,
    coachNoGrade: coachNoGrade.length,
    changeReasonBreakdown: tally(changed.flatMap((d) => d.reasonCodes)),
    noGradeReasonBreakdown: tally(noGrade.flatMap((d) => d.reasonCodes)),
    blindComparison,
    averageReviewSeconds,
    measuredReviewMinutes,
    sessionElapsedMinutes,
    baselineMinutes,
    baselineRevisedMinutes,
    comparison,
    trustRating: state.feedback?.trustRating ?? null,
  };
}

/** Serializable research record. Contains no names, no personal information and no pasted URLs. */
export function buildSessionExport(state: SessionState) {
  return {
    prototype: 'FootballOS usability prototype v0.2 (Module 7)',
    note: 'All AI results in this file are simulated mock data. No video was analyzed.',
    /** 'research' or 'demo'. Demo exports must never be pooled with research sessions. */
    mode: state.mode,
    modeNote:
      state.mode === 'demo'
        ? 'Demo session — not research data. The baseline is a placeholder and no participant was involved.'
        : 'Research session: baseline captured before exposure to the review workflow.',
    accuracy: ACCURACY_STATEMENT,
    confidenceNote: CONFIDENCE_DISCLAIMER,
    blindFirstNote:
      'The blind-first comparison is an exploratory signal about reliance on one play. It is not a validated measure of accuracy or bias.',
    sessionId: state.sessionId,
    startedAt: state.startedAtIso,
    exportedAt: new Date().toISOString(),
    baseline: state.baseline,
    baselineRevision: state.baselineRevision,
    filmSource: state.filmSource,
    filmLinkHost: state.filmLinkHost,
    decisions: state.decisions,
    blindGrades: state.blindGrades,
    practiceFocus: buildPracticeFocus(state.decisions),
    recommendationState: state.recommendationState,
    recommendationEdit: state.recommendationEdit,
    recommendationReviewedAt: state.recommendationReviewedAt,
    feedback: state.feedback,
    timingDefinitions: TIMING_DEFINITIONS,
    summary: buildSummary(state),
    events: state.events,
  };
}

export function sessionJson(state: SessionState): string {
  return JSON.stringify(buildSessionExport(state), null, 2);
}
