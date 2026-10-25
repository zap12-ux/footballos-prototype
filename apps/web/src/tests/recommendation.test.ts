import { describe, it, expect } from 'vitest';
import { buildPracticeFocus } from '../utils/recommendation';
import { buildSummary, buildSessionExport } from '../utils/summary';
import { initialState, reducer } from '../state/SessionContext';
import type { CoachDecision, SessionState } from '../types';

function decision(
  partial: Partial<CoachDecision> & { playId: string; playNumber: number },
): CoachDecision {
  return {
    candidateGrade: 2,
    candidateGradeConfidence: 'Medium',
    candidateIdConfidence: 'High',
    finalGrade: 2,
    action: 'accepted',
    reasonCodes: [],
    reviewSeconds: 30,
    timestamp: new Date().toISOString(),
    revision: 1,
    ...partial,
  };
}

describe('practice focus', () => {
  it('excludes No Grade and unreviewed plays from the recommendation and says so', () => {
    const focus = buildPracticeFocus({
      'play-2': decision({ playId: 'play-2', playNumber: 2 }),
      'play-3': decision({
        playId: 'play-3',
        playNumber: 3,
        candidateGrade: 'NG',
        finalGrade: 'NG',
        action: 'no_grade',
        reasonCodes: ['not_visible'],
      }),
      'play-5': decision({ playId: 'play-5', playNumber: 5 }),
    });

    expect(focus.kind).toBe('focus');
    expect(focus.gradedCount).toBe(2);
    expect(focus.reviewedCount).toBe(3);
    expect(focus.excludedPlayNumbers).toEqual([3]);
    expect(focus.unreviewedPlayNumbers).toEqual([1, 4, 6]);
    expect(focus.supportingPlayNumbers).toEqual([2, 5]);
    expect(focus.coverageStatement).toBe(
      'Based on 2 coach-graded plays of 3 reviewed. Play 3 was No Grade and is not included. Play 1, Play 4, Play 6 have not been reviewed and are not included.',
    );
    expect(focus.driverReasonCode).toBe('hand_placement');
    expect(focus.findings.map((f) => f.source)).toEqual(['accepted_candidate', 'accepted_candidate']);
  });

  it('never turns a correction to Grade 3 into a player deficiency', () => {
    const focus = buildPracticeFocus({
      // Candidate implied hand placement, but the coach says the standard was met.
      'play-2': decision({
        playId: 'play-2',
        playNumber: 2,
        finalGrade: 3,
        action: 'changed',
        reasonCodes: ['hand_placement'],
      }),
      'play-5': decision({ playId: 'play-5', playNumber: 5 }),
    });

    expect(focus.findings).toHaveLength(1);
    expect(focus.findings[0]).toMatchObject({ playNumber: 5, reasonCode: 'hand_placement' });
    expect(focus.supportingPlayNumbers).toEqual([5]);
    expect(focus.nonTeachingNotes[0]).toMatch(/Play 2 was corrected to Grade 3/);
  });

  it('logs "AI misread" and "Other" but does not build a teaching point from them', () => {
    const focus = buildPracticeFocus({
      'play-2': decision({
        playId: 'play-2',
        playNumber: 2,
        finalGrade: 1,
        action: 'changed',
        reasonCodes: ['ai_misread'],
      }),
      'play-5': decision({
        playId: 'play-5',
        playNumber: 5,
        finalGrade: 1,
        action: 'changed',
        reasonCodes: ['other'],
      }),
    });

    // Both plays are Grade 1 with review-only reasons: a problem exists but nothing says what to coach.
    expect(focus.kind).toBe('clarify');
    expect(focus.driverReasonCode).toBeNull();
    expect(focus.findings).toHaveLength(0);
    expect(focus.nonTeachingNotes).toHaveLength(2);
    expect(focus.unresolvedPlays.map((u) => u.playNumber)).toEqual([2, 5]);
    expect(focus.focusTitle).toMatch(/Clarify the coaching issue/i);
    expect(focus.teachingCue).not.toMatch(/standard (already )?being met|reinforce/i);
  });

  it('uses the coach-supplied reason, not the original candidate, when a grade was changed', () => {
    const focus = buildPracticeFocus({
      'play-2': decision({
        playId: 'play-2',
        playNumber: 2,
        finalGrade: 1,
        action: 'changed',
        reasonCodes: ['pad_level'],
      }),
    });
    expect(focus.driverReasonCode).toBe('pad_level');
    expect(focus.findings[0].source).toBe('coach_changed');
  });

  it('reinforces, limited to the graded plays, when every coach grade is 3', () => {
    const focus = buildPracticeFocus({
      'play-1': decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3 }),
    });
    expect(focus.kind).toBe('reinforce');
    expect(focus.driverReasonCode).toBeNull();
    expect(focus.supportingPlayNumbers).toEqual([1]);
    expect(focus.limitations[0]).toMatch(/covers only the 1 coach-graded play/);
    expect(focus.coverageStatement).toContain('No reviewed plays were excluded.');
  });

  it('shows an insufficient-evidence state when no reviewed play has a coach grade', () => {
    const focus = buildPracticeFocus({
      'play-3': decision({
        playId: 'play-3',
        playNumber: 3,
        candidateGrade: 'NG',
        finalGrade: 'NG',
        action: 'accepted',
        reasonCodes: ['identity_unresolved'],
      }),
      'play-6': decision({
        playId: 'play-6',
        playNumber: 6,
        candidateGrade: 'NG',
        finalGrade: 'NG',
        action: 'no_grade',
        reasonCodes: ['film_quality'],
      }),
    });
    expect(focus.kind).toBe('insufficient');
    expect(focus.focusTitle).toMatch(/Insufficient evidence/);
    expect(focus.focusTitle).not.toMatch(/Maintain/);
    expect(focus.supportingPlayNumbers).toEqual([]);
    expect(focus.gradedCount).toBe(0);
  });
});

describe('session reducer', () => {
  it('marks a reviewed practice focus stale when a decision changes', () => {
    let state: SessionState = { ...initialState(), recommendationState: 'accepted' };
    state = reducer(state, {
      type: 'recordDecision',
      decision: decision({ playId: 'play-1', playNumber: 1, finalGrade: 1, action: 'changed', reasonCodes: ['finish'] }),
    });
    expect(state.recommendationState).toBe('stale');
    expect(state.decisions['play-1'].revision).toBe(1);
    expect(state.events.map((e) => e.event)).toContain('recommendation_invalidated');

    // Re-accepting clears the stale state; further changes mark it stale again.
    state = reducer(state, { type: 'setRecommendation', state: 'accepted' });
    expect(state.recommendationState).toBe('accepted');
    state = reducer(state, {
      type: 'recordDecision',
      decision: decision({ playId: 'play-1', playNumber: 1, finalGrade: 2, action: 'changed', reasonCodes: ['finish'] }),
    });
    expect(state.recommendationState).toBe('stale');
    expect(state.decisions['play-1'].revision).toBe(2);
  });

  it('keeps only the host of a pasted link', () => {
    const state = reducer(initialState(), {
      type: 'recordFilmLink',
      url: 'https://www.youtube.com/watch?v=secret',
    });
    expect(state.filmLinkHost).toBe('www.youtube.com');
    expect(JSON.stringify(state)).not.toContain('secret');
  });
});

describe('session summary and export', () => {
  function sixDecisions(): Record<string, CoachDecision> {
    return {
      'play-1': decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3 }),
      'play-2': decision({ playId: 'play-2', playNumber: 2 }),
      'play-3': decision({ playId: 'play-3', playNumber: 3, candidateGrade: 'NG', finalGrade: 'NG', reasonCodes: ['not_visible'] }),
      'play-4': decision({
        playId: 'play-4',
        playNumber: 4,
        candidateGrade: 1,
        finalGrade: 2,
        action: 'changed',
        reasonCodes: ['hand_placement'],
        blindGrade: 2,
        movedTowardCandidate: false,
        reviewSeconds: 45,
      }),
      'play-5': decision({ playId: 'play-5', playNumber: 5 }),
      'play-6': decision({ playId: 'play-6', playNumber: 6, candidateGrade: 'NG', finalGrade: 'NG', reasonCodes: ['film_quality'] }),
    };
  }

  it('only compares timing when all six plays have a decision', () => {
    const base: SessionState = {
      ...initialState(),
      startedAtMs: Date.now() - 120000,
      baseline: {
        minutesForSixSnaps: 25,
        method: 'Film only, no separate notes',
        timestamp: new Date().toISOString(),
        estimateStatus: 'provided',
        capturedBeforeReviewTask: true,
        exposure: null,
      },
      reviewIntervals: [
        { playId: 'play-1', startMs: 0, endMs: 60000, closedBy: 'navigation' },
        { playId: 'play-2', startMs: 60000, endMs: 90000, closedBy: 'navigation' },
      ],
    };
    const partial = buildSummary({ ...base, decisions: { 'play-2': decision({ playId: 'play-2', playNumber: 2 }) } });
    expect(partial.comparison.comparable).toBe(false);
    expect(partial.comparison.exploratoryDifferenceMinutes).toBeNull();
    expect(partial.comparison.reason).toMatch(/1 of 6/);

    const full = buildSummary({ ...base, decisions: sixDecisions() });
    expect(full.comparison.comparable).toBe(true);
    expect(full.timing.accumulatedReviewMinutes).toBe(1.5);
    expect(full.comparison.exploratoryDifferenceMinutes).toBeCloseTo(25 - 1.5, 5);
    expect(full.comparison.reason).toMatch(/Exploratory/);
    expect(full.comparison.scopeNotes.length).toBeGreaterThan(0);
    expect(full.timing.sessionElapsedMinutes).toBeGreaterThan(0);
  });

  it('serializes to JSON with the summary, decisions, definitions and events', () => {
    const state: SessionState = {
      ...initialState(),
      baseline: {
        minutesForSixSnaps: 25,
        method: 'Film only, no separate notes',
        timestamp: new Date().toISOString(),
        estimateStatus: 'provided',
        capturedBeforeReviewTask: true,
        exposure: null,
      },
      decisions: {
        'play-2': decision({ playId: 'play-2', playNumber: 2 }),
        'play-4': decision({
          playId: 'play-4',
          playNumber: 4,
          candidateGrade: 1,
          finalGrade: 2,
          action: 'changed',
          reasonCodes: ['hand_placement'],
          blindGrade: 2,
          movedTowardCandidate: false,
          reviewSeconds: 45,
        }),
      },
      blindGrades: { 'play-4': 2 },
      filmLinkHost: 'www.youtube.com',
    };

    const summary = buildSummary(state);
    expect(summary.playsReviewed).toBe(2);
    expect(summary.playsGraded).toBe(2);
    expect(summary.changed).toBe(1);
    expect(summary.changeReasonBreakdown).toEqual([
      { code: 'hand_placement', label: 'Hand placement', count: 1 },
    ]);
    expect(summary.blindComparison).toMatchObject({
      playNumber: 4,
      blindGrade: 2,
      candidateGrade: 1,
      finalGrade: 2,
      movedTowardCandidate: false,
    });
    expect(summary.baseline.minutes).toBe(25);

    const exported = buildSessionExport(state);
    const json = JSON.stringify(exported);
    expect(exported.summary.playsGraded).toBe(2);
    expect(exported.accuracy).toMatch(/not evaluated/);
    expect(exported.timingDefinitions.accumulatedReviewMinutes).toMatch(/across every visit/);
    expect(exported.filmLinkHost).toBe('www.youtube.com');
    expect(json).not.toMatch(/filmLinkUrl/);
    expect(json).not.toMatch(/api[_-]?key/i);
  });
});
