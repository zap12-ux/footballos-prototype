import { PLAYS } from '../data/plays';
import { reasonLabel } from '../data/reasons';
import { ACCURACY_STATEMENT, CONFIDENCE_DISCLAIMER } from '../data/team';
import type { CoachDecision, GradeValue, ReasonCode, SessionState } from '../types';
import { buildPracticeFocus } from './recommendation';
import { secondsByPlay, totalReviewSeconds } from './reviewTime';

/**
 * Exactly what each timing measure includes. Shown in the UI and written to the export
 * so a reader never has to guess what was compared.
 */
export const TIMING_DEFINITIONS = {
  baselineMinutes:
    'Self-reported on the research entry screen, before the review task started: the minutes the coach says it normally takes to grade six comparable offensive-line snaps with their own film and method. A coach may answer "I\'m not sure", in which case no number is recorded. Known prior exposure (landing page, earlier demo in this browser, self-report) is recorded next to it; it is not a guarantee of no exposure.',
  accumulatedReviewMinutes:
    'Sum, over all six plays, of every review interval: the time the play-review screen was open for that play while the browser tab was visible, across every visit, whether or not a decision was saved during the visit. Reopening a play adds to its time; saving, re-saving or picking a reason neither starts nor ends an interval. Excludes the research entry, team context, film, queue, practice focus and results screens, time with the tab hidden, and anything after the last heartbeat before a reload or closed tab.',
  sessionElapsedMinutes:
    'Wall-clock minutes from "Begin Review" (or the start of a demo) to now, including every screen, hidden-tab time and any idle time.',
  exploratoryDifferenceMinutes:
    'Baseline minutes minus accumulated review minutes. Computed only in a research session with a numeric baseline, accumulated timing, and a final decision on all six plays. The two numbers describe different tasks (see scope notes). An exploratory comparison against a self-reported estimate, not a measured productivity improvement.',
} as const;

/** The two tasks being compared are not the same task. These notes travel with every comparison. */
export const COMPARISON_SCOPE_NOTES: string[] = [
  'Baseline: the coach\'s own film, own method, and full grading of six snaps, as they estimated it from memory.',
  'Measured: time on the play-review screen only, with candidate grades, rationales and evidence already prepared (authored, not computed), on a fictional program\'s six prepared snaps.',
  'Not in the measured time: film selection, reading the team context, the queue, the practice focus, feedback, and any time with the tab hidden.',
  'The estimate is self-reported and unverified; the measured time is from one sitting with a prototype. Neither is a productivity measurement.',
];

export interface SessionSummary {
  playsReviewed: number;
  playsTotal: number;
  playsGraded: number;
  playsNoGrade: number;
  accepted: number;
  changed: number;
  coachNoGrade: number;
  /** Decisions that were revised at least once (revision > 1). */
  revisedPlays: number;
  changeReasonBreakdown: { code: ReasonCode; label: string; count: number }[];
  noGradeReasonBreakdown: { code: ReasonCode; label: string; count: number }[];
  blindComparison: {
    playNumber: number;
    blindGrade: GradeValue | null;
    candidateGrade: GradeValue;
    finalGrade: GradeValue | null;
    movedTowardCandidate: boolean | null;
  } | null;
  timing: {
    schema: SessionState['timingSchema'];
    /** Null when the session predates accumulated timing. */
    accumulatedReviewMinutes: number | null;
    /** Per play, seconds across all visits. Empty for legacy sessions. */
    reviewSecondsByPlay: { playNumber: number; seconds: number; visits: number }[];
    averageReviewSecondsPerReviewedPlay: number | null;
    sessionElapsedMinutes: number | null;
    /** Legacy sessions only: the per-decision latest-visit seconds that were recorded, labelled as such. */
    legacyLatestVisitSeconds: { playNumber: number; seconds: number }[] | null;
  };
  baseline: {
    collected: boolean;
    minutes: number | null;
    estimateStatus: 'provided' | 'not_sure' | null;
    revisions: number[];
    /** Null when no baseline exists or the session predates exposure tracking. */
    exposureRecorded: boolean;
  };
  comparison: {
    comparable: boolean;
    reason: string;
    exploratoryDifferenceMinutes: number | null;
    scopeNotes: string[];
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

function tenths(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildSummary(state: SessionState, now: number = Date.now()): SessionSummary {
  const decisions = Object.values(state.decisions) as CoachDecision[];
  const graded = decisions.filter((d) => d.finalGrade !== 'NG');
  const noGrade = decisions.filter((d) => d.finalGrade === 'NG');
  const accepted = decisions.filter((d) => d.action === 'accepted');
  const changed = decisions.filter((d) => d.action === 'changed');
  const coachNoGrade = decisions.filter((d) => d.action === 'no_grade');

  // Timing. Include an interval that is open right now (the summary is normally built on
  // another screen, so there is none; a seeded state may carry one).
  const intervals = state.openReview
    ? [
        ...state.reviewIntervals,
        {
          playId: state.openReview.playId,
          startMs: state.openReview.startMs,
          endMs: Math.max(now, state.openReview.lastTickMs),
          closedBy: 'navigation' as const,
        },
      ]
    : state.reviewIntervals;
  const accumulated = state.timingSchema === 'accumulated_v1';
  const perPlay = secondsByPlay(intervals);
  const reviewSecondsByPlay = accumulated
    ? PLAYS.filter((p) => perPlay[p.id] !== undefined || state.decisions[p.id]).map((p) => ({
        playNumber: p.playNumber,
        seconds: perPlay[p.id] ?? 0,
        visits: intervals.filter((i) => i.playId === p.id).length,
      }))
    : [];
  const totalSeconds = accumulated ? totalReviewSeconds(intervals) : null;
  const accumulatedReviewMinutes = totalSeconds === null ? null : tenths(totalSeconds / 60);
  const averageReviewSecondsPerReviewedPlay =
    totalSeconds === null || decisions.length === 0
      ? null
      : Math.round(
          decisions.reduce((sum, d) => sum + (perPlay[d.playId] ?? 0), 0) / decisions.length,
        );
  const sessionElapsedMinutes = state.startedAtMs ? tenths((now - state.startedAtMs) / 60000) : null;
  const legacyLatestVisitSeconds = accumulated
    ? null
    : decisions
        .slice()
        .sort((a, b) => a.playNumber - b.playNumber)
        .map((d) => ({ playNumber: d.playNumber, seconds: d.reviewSeconds }));

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

  const baseline = state.mode === 'research' ? state.baseline : null;
  const baselineMinutes = baseline?.minutesForSixSnaps ?? null;
  const complete = decisions.length === PLAYS.length;

  let comparison: SessionSummary['comparison'];
  const scopeNotes = COMPARISON_SCOPE_NOTES;
  if (state.mode === 'demo') {
    comparison = {
      comparable: false,
      reason: 'No baseline collected in demo mode.',
      exploratoryDifferenceMinutes: null,
      scopeNotes,
    };
  } else if (!baseline) {
    comparison = { comparable: false, reason: 'No baseline was captured.', exploratoryDifferenceMinutes: null, scopeNotes };
  } else if (baselineMinutes === null) {
    comparison = {
      comparable: false,
      reason: 'The coach answered "I\'m not sure" for the baseline, so there is no estimate to compare against.',
      exploratoryDifferenceMinutes: null,
      scopeNotes,
    };
  } else if (!accumulated || accumulatedReviewMinutes === null) {
    comparison = {
      comparable: false,
      reason:
        'Accumulated review time is not available for this session (it was saved before review intervals were recorded), so no comparison is computed.',
      exploratoryDifferenceMinutes: null,
      scopeNotes,
    };
  } else if (!complete) {
    comparison = {
      comparable: false,
      reason: `Not comparable: ${decisions.length} of ${PLAYS.length} plays have a decision. The baseline describes six snaps, so a partial session is not compared.`,
      exploratoryDifferenceMinutes: null,
      scopeNotes,
    };
  } else {
    comparison = {
      comparable: true,
      reason:
        'Exploratory comparison against a self-reported estimate of a different task. Not a measured productivity improvement.',
      exploratoryDifferenceMinutes: tenths(baselineMinutes - accumulatedReviewMinutes),
      scopeNotes,
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
    revisedPlays: decisions.filter((d) => d.revision > 1).length,
    changeReasonBreakdown: tally(changed.flatMap((d) => d.reasonCodes)),
    noGradeReasonBreakdown: tally(noGrade.flatMap((d) => d.reasonCodes)),
    blindComparison,
    timing: {
      schema: state.timingSchema,
      accumulatedReviewMinutes,
      reviewSecondsByPlay,
      averageReviewSecondsPerReviewedPlay,
      sessionElapsedMinutes,
      legacyLatestVisitSeconds,
    },
    baseline: {
      collected: baseline !== null,
      minutes: baselineMinutes,
      estimateStatus: baseline?.estimateStatus ?? null,
      revisions: state.mode === 'research' ? state.baselineRevisions.map((r) => r.minutesForSixSnaps) : [],
      exposureRecorded: Boolean(baseline?.exposure),
    },
    comparison,
    trustRating: state.feedback?.trustRating ?? null,
  };
}

function modeNote(state: SessionState): string {
  if (state.mode === 'demo') {
    return 'Demo session — not research data. No baseline collected in demo mode and no participant was involved. Do not pool with research sessions.';
  }
  if (!state.baseline) return 'Research session; the baseline has not been captured yet.';
  const exp = state.baseline.exposure;
  if (!exp) {
    return 'Research session. The baseline was captured before this review task started. Exposure before the task was not recorded (session predates exposure tracking).';
  }
  return (
    'Research session. The baseline was captured before this review task started. ' +
    `Known exposure before it: entered via ${exp.enteredVia === 'landing_page' ? 'the landing page (example AI output shown)' : 'the research link'}; ` +
    `prior demo recorded in this browser: ${exp.priorDemoRecordedInThisBrowser ? 'yes' : 'none recorded'}; ` +
    `self-reported prior exposure: ${exp.selfReportedPriorExposure.replace('_', ' ')}. ` +
    'None of this proves the participant had never seen the prototype.'
  );
}

/** Serializable research record. Contains no names, no personal information and no pasted URLs. */
export function buildSessionExport(state: SessionState) {
  const demo = state.mode === 'demo';
  return {
    prototype: 'FootballOS usability prototype v0.3 (Module 7)',
    note: 'All AI results in this file are simulated mock data. No video was analyzed.',
    /** 'research' or 'demo'. Demo exports must never be pooled with research sessions. */
    mode: state.mode,
    modeNote: modeNote(state),
    accuracy: ACCURACY_STATEMENT,
    confidenceNote: CONFIDENCE_DISCLAIMER,
    blindFirstNote:
      'The blind-first comparison is an exploratory signal about reliance on one play. It is not a validated measure of accuracy or bias.',
    sessionId: state.sessionId,
    startedAt: state.startedAtIso,
    exportedAt: new Date().toISOString(),
    researchEntry: demo ? null : state.researchEntry,
    /** Null in demo mode: no baseline was collected and none is fabricated. */
    baseline: demo ? null : state.baseline,
    baselineRevisions: demo ? [] : state.baselineRevisions,
    baselineNote: demo
      ? 'No baseline collected in demo mode.'
      : state.baseline
        ? 'The original submission is kept unchanged in `baseline`; any later revisions are in `baselineRevisions`, oldest first.'
        : 'Not yet captured.',
    filmSource: state.filmSource,
    filmLinkHost: state.filmLinkHost,
    decisions: state.decisions,
    decisionsNote:
      'Each play holds its latest decision with a revision count. Every earlier decision is in `events` (candidate_accepted / grade_changed / no_grade_selected) with previousFinalGrade.',
    blindGrades: state.blindGrades,
    timingSchema: state.timingSchema,
    reviewIntervals: state.reviewIntervals,
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
