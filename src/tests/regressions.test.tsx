import { describe, it, expect } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { buildPracticeFocus, FOCUS_TITLES } from '../utils/recommendation';
import { buildSessionExport, buildSummary } from '../utils/summary';
import { initialState, reducer } from '../state/SessionContext';
import { loadSession, saveSession, STORAGE_KEY } from '../utils/storage';
import { accumulatedSecondsForPlay } from '../utils/reviewTime';
import type { CoachDecision, SessionState } from '../types';

/**
 * Regression coverage for the October 24 review findings:
 * practice-focus fallback, baseline-before-exposure, demo/research separation,
 * accumulated review time, and comparison gating.
 */

type User = ReturnType<typeof userEvent.setup>;

function stored(): SessionState {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as SessionState;
}

function setHash(hash: string) {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
}

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

const NG = (playId: string, playNumber: number): CoachDecision =>
  decision({ playId, playNumber, candidateGrade: 'NG', finalGrade: 'NG', action: 'accepted', reasonCodes: ['not_visible'] });

/** The exact reported failure: 3, corrected 3, NG, NG, Grade 1 for "AI misread", NG. */
function reportedScenario(): Record<string, CoachDecision> {
  return {
    'play-1': decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3 }),
    'play-2': decision({ playId: 'play-2', playNumber: 2, finalGrade: 3, action: 'changed', reasonCodes: ['ai_misread'] }),
    'play-3': NG('play-3', 3),
    'play-4': decision({ playId: 'play-4', playNumber: 4, candidateGrade: 1, finalGrade: 'NG', action: 'no_grade', reasonCodes: ['camera_angle'], blindGrade: 'NG' }),
    'play-5': decision({ playId: 'play-5', playNumber: 5, finalGrade: 1, action: 'changed', reasonCodes: ['ai_misread'] }),
    'play-6': NG('play-6', 6),
  };
}

async function openPlay(user: User, playNumber: number) {
  const row = screen.getByRole('row', { name: new RegExp(`^Play ${playNumber}\\b`) });
  await user.click(within(row).getByRole('button', { name: /Review Play|Reopen Play/i }));
}

describe('practice focus: the four states', () => {
  it('reproduces the reported Grade 1 / "AI misread" case as "clarify", never "maintain"', () => {
    const focus = buildPracticeFocus(reportedScenario());
    expect(focus.kind).toBe('clarify');
    expect(focus.focusTitle).toBe(FOCUS_TITLES.clarify);
    expect(focus.unresolvedPlays).toEqual([
      expect.objectContaining({ playNumber: 5, finalGrade: 1, recordedReasonLabels: ['AI misread the assignment'] }),
    ]);
    expect(focus.teachingCue).toMatch(/Play 5 \(Grade 1\) is below the standard/);
    expect(focus.teachingCue).toMatch(/does not identify what to coach/);
    // Nothing in the result presents the graded plays as examples of the standard being met.
    expect(focus.supportingPlayNumbers).toEqual([]);
    const text = JSON.stringify(focus).toLowerCase();
    expect(text).not.toMatch(/maintain|standard already being met|reinforce/);
    // The Grade 3 correction is logged, not a deficiency and not a finding.
    expect(focus.findings).toHaveLength(0);
    expect(focus.nonTeachingNotes.some((n) => /Play 2 was corrected to Grade 3/.test(n))).toBe(true);
    expect(focus.excludedPlayNumbers).toEqual([3, 4, 6]);
  });

  it('A: every reviewed play No Grade is insufficient evidence with a film next step', () => {
    const focus = buildPracticeFocus({
      'play-1': decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 'NG', action: 'no_grade', reasonCodes: ['not_visible'] }),
      'play-3': NG('play-3', 3),
      'play-6': NG('play-6', 6),
    });
    expect(focus.kind).toBe('insufficient');
    expect(focus.focusTitle).toBe(FOCUS_TITLES.insufficient);
    expect(focus.supportingPoints[0]).toMatch(/gradable angle/i);
    expect(focus.limitations[0]).toMatch(/Nothing here says the player met or missed the standard/);
    expect(JSON.stringify(focus)).not.toMatch(/Reinforce|standard met/);
  });

  it('B: every numeric grade 3 reinforces, limited to the graded plays, with coverage still shown', () => {
    const focus = buildPracticeFocus({
      'play-1': decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3 }),
      'play-2': decision({ playId: 'play-2', playNumber: 2, finalGrade: 3, action: 'changed', reasonCodes: ['hand_placement'] }),
      'play-3': NG('play-3', 3),
    });
    expect(focus.kind).toBe('reinforce');
    expect(focus.supportingPlayNumbers).toEqual([1, 2]);
    expect(focus.teachingCue).toMatch(/Play 1, Play 2\) was Grade 3/);
    expect(focus.limitations).toEqual([
      'This conclusion covers only the 2 coach-graded plays.',
      'Play 3 is No Grade: insufficient evidence, not a performance result.',
      'Play 4, Play 5, Play 6 have no decision yet.',
    ]);
    expect(focus.coverageStatement).toBe('Based on 2 coach-graded plays of 3 reviewed. Play 3 was No Grade and is not included. Play 4, Play 5, Play 6 have not been reviewed and are not included.');
    // The Grade 3 correction's reason is an overrule explanation, never a deficiency.
    expect(focus.findings).toHaveLength(0);
    expect(focus.nonTeachingNotes[0]).toMatch(/Play 2 was corrected to Grade 3/);
  });

  it('D: an actionable finding plus an unresolved below-standard play keeps the focus but shows the gap', () => {
    const focus = buildPracticeFocus({
      'play-2': decision({ playId: 'play-2', playNumber: 2 }), // accepted Grade 2 → hand placement
      'play-5': decision({ playId: 'play-5', playNumber: 5, finalGrade: 1, action: 'changed', reasonCodes: ['other'] }),
    });
    expect(focus.kind).toBe('focus');
    expect(focus.driverReasonCode).toBe('hand_placement');
    expect(focus.supportingPlayNumbers).toEqual([2]);
    expect(focus.driverSupport).toBe('single');
    expect(focus.unresolvedPlays.map((u) => u.playNumber)).toEqual([5]);
    expect(focus.limitations[0]).toMatch(/supported by one play \(Play 2\). It is a single finding, not a recurring issue/);
    expect(focus.limitations[1]).toMatch(/Play 5 is below the standard but carry no technique reason/);
  });

  it('D: two plays with the same technique reason are recurring; a Grade 3 correction never joins them', () => {
    const focus = buildPracticeFocus({
      'play-2': decision({ playId: 'play-2', playNumber: 2 }),
      'play-5': decision({ playId: 'play-5', playNumber: 5 }),
      'play-1': decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3, action: 'changed', reasonCodes: ['hand_placement'] }),
    });
    expect(focus.kind).toBe('focus');
    expect(focus.driverSupport).toBe('recurring');
    expect(focus.supportingPlayNumbers).toEqual([2, 5]);
    expect(focus.findings.map((f) => f.playNumber)).toEqual([2, 5]);
    expect(focus.unresolvedPlays).toEqual([]);
  });
});

describe('practice focus invalidation', () => {
  it('marks an accepted, edited or dismissed focus stale when any decision changes afterwards', () => {
    for (const reviewed of ['accepted', 'edited', 'dismissed'] as const) {
      let state = reducer(initialState(), { type: 'setRecommendation', state: reviewed, edit: reviewed === 'edited' ? 'My focus' : null });
      expect(state.recommendationState).toBe(reviewed);
      state = reducer(state, {
        type: 'recordDecision',
        decision: decision({ playId: 'play-2', playNumber: 2, finalGrade: 1, action: 'changed', reasonCodes: ['finish'] }),
      });
      expect(state.recommendationState).toBe('stale');
      expect(state.events[state.events.length - 1]).toMatchObject({ event: 'recommendation_invalidated', data: { previousState: reviewed } });
    }
  });
});

describe('research entry: baseline before any example or task-duration suggestion', () => {
  it('#/research shows the neutral baseline form first, with an empty field and no anchors, and records "not sure" as missing', async () => {
    const user = userEvent.setup();
    setHash('#/research');
    render(<App />);

    expect(screen.getByRole('heading', { name: /^Research session$/ })).toBeInTheDocument();
    const body = document.body.textContent ?? '';
    // No candidate grades, evidence examples or confidence labels before the baseline.
    expect(document.querySelectorAll('.grade-badge').length).toBe(0);
    expect(body).not.toMatch(/confidence/i);
    expect(body).not.toMatch(/candidate|rationale|evidence/i);
    // No suggested completion time and no numeric anchors for the estimate.
    expect(body).not.toMatch(/about \d+ minutes/i);
    expect(screen.queryAllByRole('button', { name: /^\d+ min$/ })).toHaveLength(0);
    const minutes = screen.getByLabelText(/^Minutes$/i) as HTMLInputElement;
    expect(minutes.value).toBe('');

    // "I'm not sure" records a missing estimate instead of forcing a number.
    await user.click(screen.getByRole('button', { name: /I.m not sure/i }));
    expect(minutes).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Film only, no separate notes/i }));
    await user.click(screen.getByRole('radio', { name: /^Not sure$/ }));
    await user.click(screen.getByRole('button', { name: /Begin Review/i }));

    const state = stored();
    expect(state.baseline).toMatchObject({
      minutesForSixSnaps: null,
      estimateStatus: 'not_sure',
      capturedBeforeReviewTask: true,
      exposure: expect.objectContaining({
        enteredVia: 'research_link',
        landingPageSeenThisVisit: false,
        selfReportedPriorExposure: 'not_sure',
      }),
    });
    expect(state.baseline?.exposure?.note).toMatch(/not proof of no exposure/);
    // The task brief, with its expected length, appears only now.
    expect(screen.getByTestId('task-brief')).toHaveTextContent(/About 10 minutes/);
    expect(screen.getByRole('heading', { name: /Team context/i })).toBeInTheDocument();
  });

  it('entering research from the landing page records that example output was shown first', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Start a research session/i }));
    expect(screen.getByTestId('landing-exposure-note')).toHaveTextContent(/landing page, which shows example output/);
    await user.type(screen.getByLabelText(/^Minutes$/i), '15');
    await user.click(screen.getByRole('button', { name: /Hudl or a similar video platform/i }));
    await user.click(screen.getByRole('radio', { name: /^Yes$/ }));
    await user.click(screen.getByRole('button', { name: /Begin Review/i }));

    const baseline = stored().baseline;
    expect(baseline?.minutesForSixSnaps).toBe(15);
    expect(baseline?.exposure).toMatchObject({
      enteredVia: 'landing_page',
      landingPageSeenThisVisit: true,
      selfReportedPriorExposure: 'yes',
    });
    const exported = buildSessionExport(stored());
    expect(exported.modeNote).toMatch(/entered via the landing page/);
    expect(exported.modeNote).toMatch(/None of this proves/);
    expect(exported.modeNote).not.toMatch(/before any exposure/);
  });

  it('a later revision is stored separately and the original submission is untouched', () => {
    let state = reducer(reducer(initialState(), { type: 'startResearch' }), {
      type: 'captureBaseline',
      baseline: { minutesForSixSnaps: 20, estimateStatus: 'provided', method: 'Film only', selfReportedPriorExposure: 'no' },
    });
    const original = state.baseline;
    state = reducer(state, { type: 'reviseBaseline', minutes: 35 });
    state = reducer(state, { type: 'reviseBaseline', minutes: 30 });
    expect(state.baseline).toEqual(original);
    expect(state.baselineRevisions.map((r) => r.minutesForSixSnaps)).toEqual([35, 30]);
    // A second capture never overwrites the first.
    const again = reducer(state, {
      type: 'captureBaseline',
      baseline: { minutesForSixSnaps: 5, estimateStatus: 'provided', method: 'x', selfReportedPriorExposure: 'no' },
    });
    expect(again.baseline).toEqual(original);
  });
});

describe('demo mode never fabricates a baseline', () => {
  it('results screen and export say "No baseline collected in demo mode" with no revision control or timestamp', async () => {
    let state = reducer(initialState(), { type: 'startDemo' });
    state = reducer(state, {
      type: 'recordDecision',
      decision: decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3 }),
    });
    // Revising a baseline in demo mode is a no-op.
    expect(reducer(state, { type: 'reviseBaseline', minutes: 10 })).toBe(state);

    render(<App seed={{ ...state, screen: 'summary' }} />);
    expect(screen.getByTestId('baseline-readonly')).toHaveTextContent('No baseline collected in demo mode.');
    expect(screen.getByTestId('timing-baseline')).toHaveTextContent('No baseline collected in demo mode.');
    expect(screen.queryByRole('button', { name: /My earlier estimate was off/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('baseline-card').textContent).not.toMatch(/Captured|before this review task|exposure/i);
    expect(screen.getByTestId('timing-comparison')).toHaveTextContent(/Not computed/);

    const exported = buildSessionExport(state);
    expect(exported.mode).toBe('demo');
    expect(exported.baseline).toBeNull();
    expect(exported.baselineRevisions).toEqual([]);
    expect(exported.baselineNote).toBe('No baseline collected in demo mode.');
    expect(exported.summary.baseline).toMatchObject({ collected: false, minutes: null, exposureRecorded: false });
    expect(exported.summary.comparison.reason).toBe('No baseline collected in demo mode.');
    expect(JSON.stringify(exported)).not.toMatch(/capturedBefore/);
  });

  it('the reported scenario, driven through the UI, lands on "clarify" with a working Reopen action', async () => {
    const user = userEvent.setup();
    setHash('#/demo');
    render(<App />);
    await screen.findByRole('heading', { name: /Review queue/i });

    await openPlay(user, 1);
    await user.click(screen.getByRole('button', { name: /Accept candidate/i }));
    await screen.findByTestId('decision-recorded');
    await user.click(screen.getByRole('button', { name: /Back to queue/i }));

    await openPlay(user, 2);
    await user.click(screen.getByRole('button', { name: /Change to Grade 3/i }));
    await user.click(screen.getByRole('button', { name: /AI misread the assignment/i }));
    await screen.findByTestId('decision-recorded');
    await user.click(screen.getByRole('button', { name: /Back to queue/i }));

    for (const n of [3, 6]) {
      await openPlay(user, n);
      await user.click(screen.getByRole('button', { name: /Accept candidate \(No Grade\)/i }));
      await user.click(screen.getByRole('button', { name: /Player not visible/i }));
      await screen.findByTestId('decision-recorded');
      await user.click(screen.getByRole('button', { name: /Back to queue/i }));
    }

    await openPlay(user, 4);
    await user.click(screen.getByRole('button', { name: /^No Grade$/ }));
    await user.click(screen.getByRole('button', { name: /Submit my grade and reveal/i }));
    await user.click(await screen.findByRole('button', { name: /Mark No Grade/i }));
    await user.click(screen.getByRole('button', { name: /Camera angle insufficient/i }));
    await screen.findByTestId('decision-recorded');
    await user.click(screen.getByRole('button', { name: /Back to queue/i }));

    await openPlay(user, 5);
    await user.click(screen.getByRole('button', { name: /Change to Grade 1/i }));
    await user.click(screen.getByRole('button', { name: /AI misread the assignment/i }));
    await screen.findByTestId('decision-recorded');
    await user.click(screen.getByRole('button', { name: /Continue to practice focus/i }));

    expect(await screen.findByTestId('focus-clarify')).toBeInTheDocument();
    expect(screen.getByTestId('focus-title')).toHaveTextContent(/Clarify the coaching issue/);
    expect(screen.getByTestId('focus-unresolved')).toHaveTextContent(/Play 5 · Grade 1/);
    expect(screen.getByTestId('focus-unresolved')).toHaveTextContent(/AI misread the assignment/);
    expect(screen.queryByRole('button', { name: /^Accept$/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/standard already being met|Reinforce the standard/);
    expect(screen.getByTestId('coverage-statement')).toHaveTextContent('Based on 3 coach-graded plays of 6 reviewed. Play 3, Play 4, Play 6 were No Grade and are not included.');

    // The reopen action is real: it opens Play 5 on the review screen.
    await user.click(within(screen.getByTestId('focus-unresolved')).getByRole('button', { name: /Reopen Play 5/i }));
    expect(await screen.findByTestId('review-context')).toHaveTextContent(/Play 5 of 6/);
    expect(stored().activePlayId).toBe('play-5');
  }, 90000);
});

describe('accumulated review time', () => {
  const T = (s: number) => 1_000_000 + s * 1000;

  function withReviewTiming(): SessionState {
    let state = reducer(initialState(), { type: 'startResearch' });
    state = { ...state, startedAtMs: T(0) };
    state = reducer(state, { type: 'reviewOpen', playId: 'play-1', atMs: T(0) });
    state = reducer(state, { type: 'reviewOpen', playId: 'play-1', atMs: T(3) }); // duplicate open: no-op
    state = reducer(state, { type: 'reviewClose', closedBy: 'navigation', atMs: T(10) });
    state = reducer(state, { type: 'reviewOpen', playId: 'play-2', atMs: T(10) });
    state = reducer(state, { type: 'reviewClose', closedBy: 'tab_hidden', atMs: T(15) });
    state = reducer(state, { type: 'reviewOpen', playId: 'play-2', atMs: T(40) }); // tab visible again
    state = reducer(state, { type: 'reviewClose', closedBy: 'navigation', atMs: T(45) });
    return state;
  }

  it('reopening a play adds to its time, and repeated saves never double-count', () => {
    let state = withReviewTiming();
    expect(state.reviewIntervals).toHaveLength(3);
    expect(accumulatedSecondsForPlay(state, 'play-1', T(45))).toBe(10);
    expect(accumulatedSecondsForPlay(state, 'play-2', T(45))).toBe(10);

    // Reopen Play 1 and save twice: the second save reports the same stretch once, a little longer.
    state = reducer(state, { type: 'reviewOpen', playId: 'play-1', atMs: T(60) });
    state = reducer(state, {
      type: 'recordDecision',
      decision: decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3 }),
      atMs: T(65),
    });
    expect(state.decisions['play-1'].reviewSeconds).toBe(15);
    state = reducer(state, {
      type: 'recordDecision',
      decision: decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 2, action: 'changed', reasonCodes: ['finish'] }),
      atMs: T(67),
    });
    expect(state.decisions['play-1'].reviewSeconds).toBe(17);
    expect(state.decisions['play-1'].revision).toBe(2);
    // Saving did not create or close an interval.
    expect(state.reviewIntervals).toHaveLength(3);
    expect(state.openReview?.playId).toBe('play-1');

    state = reducer(state, { type: 'reviewClose', closedBy: 'navigation', atMs: T(70) });
    const summary = buildSummary(state, T(70));
    expect(summary.timing.reviewSecondsByPlay).toEqual([
      { playNumber: 1, seconds: 20, visits: 2 },
      { playNumber: 2, seconds: 10, visits: 2 },
    ]);
    expect(summary.timing.accumulatedReviewMinutes).toBe(0.5);
    expect(summary.timing.sessionElapsedMinutes).toBeGreaterThan(summary.timing.accumulatedReviewMinutes ?? 0);
    // Both versions of the Play 1 decision are in the event history with the revision trail.
    const history = state.events.filter((e) => e.playId === 'play-1' && /accepted|changed/.test(e.event));
    expect(history.map((e) => [e.data?.finalGrade, e.data?.previousFinalGrade, e.data?.revision])).toEqual([
      ['3', null, 1],
      ['2', '3', 2],
    ]);
  });

  it('a reload with an interval open closes it at the last heartbeat instead of losing or inventing time', () => {
    let state = withReviewTiming();
    state = reducer(state, { type: 'reviewOpen', playId: 'play-3', atMs: T(100) });
    state = reducer(state, { type: 'reviewTick', atMs: T(105) });
    state = reducer(state, { type: 'reviewTick', atMs: T(104) }); // out of order: ignored
    saveSession(state);
    const reloaded = loadSession();
    expect(reloaded?.openReview).toBeNull();
    expect(reloaded?.reviewIntervals[reloaded.reviewIntervals.length - 1]).toEqual({
      playId: 'play-3',
      startMs: T(100),
      endMs: T(105),
      closedBy: 'recovered_on_load',
    });
    expect(reloaded?.timingSchema).toBe('accumulated_v1');
  });

  it('legacy sessions keep their latest-visit seconds but get no fabricated cumulative time', () => {
    const legacy = {
      schemaVersion: 2,
      sessionId: 'fos-legacy',
      screen: 'summary',
      startedAtMs: Date.now() - 600000,
      startedAtIso: new Date().toISOString(),
      baseline: { minutesForSixSnaps: 20, method: 'Film only', timestamp: 't', capturedBeforeTask: true },
      baselineRevision: { minutesForSixSnaps: 25, timestamp: 't2', note: 'Revised on summary screen; original estimate retained.' },
      decisions: {
        'play-1': decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3, reviewSeconds: 42 }),
      },
      blindGrades: {},
      revealed: {},
      activePlayId: null,
      recommendationState: 'pending',
      recommendationEdit: null,
      recommendationReviewedAt: null,
      feedback: null,
      events: [],
      filmSource: 'demo',
      filmLabel: 'x',
      filmLinkHost: null,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    const loaded = loadSession();
    expect(loaded?.timingSchema).toBe('legacy_latest_visit');
    expect(loaded?.reviewIntervals).toEqual([]);
    expect(loaded?.baseline).toMatchObject({ minutesForSixSnaps: 20, estimateStatus: 'provided', capturedBeforeReviewTask: true, exposure: null });
    expect(loaded?.baselineRevisions.map((r) => r.minutesForSixSnaps)).toEqual([25]);
    expect(loaded?.decisions['play-1'].reviewSeconds).toBe(42);

    const summary = buildSummary(loaded as SessionState);
    expect(summary.timing.accumulatedReviewMinutes).toBeNull();
    expect(summary.timing.legacyLatestVisitSeconds).toEqual([{ playNumber: 1, seconds: 42 }]);
    expect(summary.comparison.comparable).toBe(false);
    expect(summary.comparison.reason).toMatch(/not available for this session/i);

    // A legacy demo session's placeholder baseline is dropped, not read as data.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...legacy, mode: 'demo', baseline: { minutesForSixSnaps: null, method: 'Demo', timestamp: 't', capturedBeforeTask: true, demo: true } }),
    );
    expect(loadSession()?.baseline).toBeNull();
  });

  it('the review screen opens and closes intervals as the coach moves between plays', async () => {
    const user = userEvent.setup();
    setHash('#/demo');
    render(<App />);
    await screen.findByRole('heading', { name: /Review queue/i });
    await openPlay(user, 1);
    await waitFor(() => expect(stored().openReview?.playId).toBe('play-1'));
    await user.click(screen.getByRole('button', { name: /Accept candidate/i }));
    await screen.findByTestId('decision-recorded');
    await user.click(screen.getByRole('button', { name: /Continue to Play 2/i }));
    await waitFor(() => expect(stored().openReview?.playId).toBe('play-2'));
    let s = stored();
    expect(s.reviewIntervals.map((i) => i.playId)).toEqual(['play-1']);
    expect(s.reviewIntervals[0].closedBy).toBe('navigation');

    await user.click(screen.getByRole('button', { name: /Back to queue/i }));
    await openPlay(user, 1);
    await waitFor(() => expect(stored().reviewIntervals.length).toBe(2));
    s = stored();
    expect(s.reviewIntervals.map((i) => i.playId)).toEqual(['play-1', 'play-2']);
    expect(s.openReview?.playId).toBe('play-1');
    const opened = stored().events.filter((e) => e.event === 'play_opened');
    expect(opened[opened.length - 1]?.data?.previousVisits).toBe(1);
  });
});

describe('comparison gating', () => {
  const base = (): SessionState => ({
    ...reducer(initialState(), { type: 'startResearch' }),
    startedAtMs: Date.now() - 300000,
    reviewIntervals: [{ playId: 'play-1', startMs: 0, endMs: 30000, closedBy: 'navigation' }],
  });
  const six = (): Record<string, CoachDecision> => ({
    'play-1': decision({ playId: 'play-1', playNumber: 1, candidateGrade: 3, finalGrade: 3 }),
    'play-2': decision({ playId: 'play-2', playNumber: 2 }),
    'play-3': NG('play-3', 3),
    'play-4': decision({ playId: 'play-4', playNumber: 4, candidateGrade: 1, finalGrade: 2, action: 'changed', reasonCodes: ['hand_placement'] }),
    'play-5': decision({ playId: 'play-5', playNumber: 5 }),
    'play-6': NG('play-6', 6),
  });
  const baseline = (minutes: number | null) => ({
    minutesForSixSnaps: minutes,
    estimateStatus: minutes === null ? ('not_sure' as const) : ('provided' as const),
    method: 'Film only',
    timestamp: 't',
    capturedBeforeReviewTask: true as const,
    exposure: null,
  });

  it('is suppressed for a missing baseline, a "not sure" baseline, a partial review and a legacy session', () => {
    expect(buildSummary({ ...base(), decisions: six() }).comparison.reason).toBe('No baseline was captured.');
    expect(buildSummary({ ...base(), baseline: baseline(null), decisions: six() }).comparison.reason).toMatch(/not sure/i);
    const partial = buildSummary({ ...base(), baseline: baseline(20), decisions: { 'play-1': six()['play-1'] } });
    expect(partial.comparison.comparable).toBe(false);
    expect(partial.comparison.reason).toMatch(/1 of 6 plays/);
    const legacy = buildSummary({ ...base(), baseline: baseline(20), decisions: six(), timingSchema: 'legacy_latest_visit' });
    expect(legacy.comparison.comparable).toBe(false);
    expect(legacy.comparison.reason).toMatch(/Accumulated review time is not available/);
  });

  it('is computed only with a numeric baseline and six decisions, labelled exploratory with scope notes', () => {
    const full = buildSummary({ ...base(), baseline: baseline(20), decisions: six() });
    expect(full.comparison.comparable).toBe(true);
    expect(full.comparison.exploratoryDifferenceMinutes).toBe(19.5);
    expect(full.comparison.reason).toMatch(/Exploratory comparison against a self-reported estimate/);
    expect(full.comparison.reason).not.toMatch(/demonstrat|proves|saves time|faster/i);
    expect(full.comparison.scopeNotes.join(' ')).toMatch(/own film, own method/);
    expect(full.comparison.scopeNotes.join(' ')).toMatch(/Neither is a productivity measurement/);
  });
});
