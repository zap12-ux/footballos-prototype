import { describe, it, expect } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { STORAGE_KEY } from '../utils/storage';
import type { SessionState } from '../types';

type User = ReturnType<typeof userEvent.setup>;

function stored(): SessionState {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as SessionState;
}

/** Enter the research flow from the landing page (Screen 1, baseline first). */
async function toResearchIntro(user: User) {
  render(<App />);
  await user.click(screen.getByRole('button', { name: /Start a research session/i }));
}

async function beginSession(user: User) {
  await toResearchIntro(user);
  await user.type(screen.getByLabelText(/Minutes \(approximate\)/i), '20');
  await user.click(screen.getByRole('button', { name: /Film plus paper or a spreadsheet/i }));
  await user.click(screen.getByRole('button', { name: /Begin Review/i }));
}

async function toQueue(user: User) {
  await beginSession(user);
  await user.click(screen.getByRole('button', { name: /Continue to film/i }));
  await user.click(screen.getByRole('button', { name: /Use Demo Film/i }));
  await screen.findByRole('heading', { name: /Review queue/i }, { timeout: 3000 });
}

async function openPlay(user: User, playNumber: number) {
  const row = screen.getByRole('row', { name: new RegExp(`^Play ${playNumber}\\b`) });
  await user.click(within(row).getByRole('button', { name: /Review Play|Reopen Play/i }));
}

async function backToQueue(user: User) {
  await user.click(screen.getByRole('button', { name: /Back to queue/i }));
}

/** Accepts the candidate. A No Grade candidate still needs a structured reason. */
async function acceptCandidate(user: User, noGradeReason?: RegExp) {
  await user.click(screen.getByRole('button', { name: /Accept candidate/i }));
  if (noGradeReason) {
    expect(screen.queryByTestId('decision-recorded')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: noGradeReason }));
  }
  await screen.findByTestId('decision-recorded');
}

async function reviewAllSix(user: User) {
  // Play 1 — accept Grade 3.
  await openPlay(user, 1);
  await acceptCandidate(user);
  await backToQueue(user);
  // Play 2 — accept Grade 2 (implied hand placement).
  await openPlay(user, 2);
  await acceptCandidate(user);
  await backToQueue(user);
  // Play 3 — accept the No Grade candidate, with a reason.
  await openPlay(user, 3);
  await acceptCandidate(user, /Cannot confirm it is No\. 62/i);
  await backToQueue(user);
  // Play 4 — blind grade, then change the candidate to Grade 2 for hand placement.
  await openPlay(user, 4);
  await user.click(screen.getByRole('button', { name: /^Grade 2$/ }));
  await user.click(screen.getByRole('button', { name: /Submit my grade and reveal/i }));
  await user.click(await screen.findByRole('button', { name: /Change to Grade 2/i }));
  await user.click(screen.getByRole('button', { name: /^Hand placement$/i }));
  await screen.findByTestId('decision-recorded');
  await backToQueue(user);
  // Play 5 — accept Grade 2.
  await openPlay(user, 5);
  await acceptCandidate(user);
  await backToQueue(user);
  // Play 6 — degraded film; accept the abstention with a reason.
  await openPlay(user, 6);
  await acceptCandidate(user, /Film quality too poor/i);
  await backToQueue(user);
}

describe('FootballOS prototype workflow', () => {
  it('captures the baseline before the review task starts', async () => {
    const user = userEvent.setup();
    await beginSession(user);

    const state = stored();
    expect(state.baseline?.capturedBeforeTask).toBe(true);
    expect(state.baseline?.minutesForSixSnaps).toBe(20);
    expect(state.startedAtMs).toBeTruthy();

    const events = state.events.map((e) => e.event);
    expect(events.indexOf('baseline_captured')).toBeLessThan(events.indexOf('session_started'));
    expect(screen.getByRole('heading', { name: /Team context/i })).toBeInTheDocument();
  });

  it('blocks Begin Review until the baseline is complete and explains why', async () => {
    const user = userEvent.setup();
    await toResearchIntro(user);
    await user.click(screen.getByRole('button', { name: /Begin Review/i }));
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(stored().baseline ?? null).toBeNull();
    expect(screen.getByRole('heading', { name: /^FootballOS$/ })).toBeInTheDocument();
  });

  it('runs simulated processing from demo film to the review queue', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    expect(screen.getByTestId('coverage-progress')).toHaveTextContent(
      '0 of 6 reviewed · 0 graded · 0 No Grade',
    );
    expect(stored().filmSource).toBe('demo');
  });

  it('forecasts coverage before the coach starts reviewing', async () => {
    const user = userEvent.setup();
    await beginSession(user);
    await user.click(screen.getByRole('button', { name: /Continue to film/i }));

    expect(screen.getByTestId('film-check-statement')).toHaveTextContent(
      '4 of 6 snaps look gradable for interior offensive line. Play 3 and Play 6 are likely to come back No Grade.',
    );

    await user.click(screen.getByRole('button', { name: /Use Demo Film/i }));
    await screen.findByRole('heading', { name: /Review queue/i }, { timeout: 3000 });
    expect(screen.getByTestId('film-check-banner')).toHaveTextContent(/4 of 6 snaps look gradable/);
  });

  it('rejects a non-video local file with a recoverable error', async () => {
    // applyAccept: false so the test exercises the app's own validation, not the browser filter.
    const user = userEvent.setup({ applyAccept: false });
    await beginSession(user);
    await user.click(screen.getByRole('button', { name: /Continue to film/i }));

    const file = new File(['not a video'], 'notes.txt', { type: 'text/plain' });
    await user.upload(screen.getByLabelText(/Choose a local film file/i), file);

    expect(screen.getByTestId('file-error')).toHaveTextContent(/is not a video file/i);
    expect(stored().filmSource).toBeNull();
    // Recovery: the demo path still works.
    await user.click(screen.getByRole('button', { name: /Use Demo Film/i }));
    await screen.findByRole('heading', { name: /Review queue/i }, { timeout: 3000 });
  });

  it('records only the host of a pasted film link and rejects invalid links', async () => {
    const user = userEvent.setup();
    await beginSession(user);
    await user.click(screen.getByRole('button', { name: /Continue to film/i }));

    await user.type(screen.getByLabelText(/Video link \(optional\)/i), 'not a link');
    await user.click(screen.getByRole('button', { name: /Record this link/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/http/i);
    expect(stored().filmLinkHost ?? null).toBeNull();

    await user.clear(screen.getByLabelText(/Video link \(optional\)/i));
    await user.type(
      screen.getByLabelText(/Video link \(optional\)/i),
      'https://www.youtube.com/watch?v=example',
    );
    await user.click(screen.getByRole('button', { name: /Record this link/i }));

    expect(screen.getByTestId('link-recorded')).toHaveTextContent('www.youtube.com');
    const state = stored();
    expect(state.filmLinkHost).toBe('www.youtube.com');
    // Neither the state nor the research log retains the URL.
    expect(JSON.stringify(state)).not.toContain('v=example');
    const event = state.events.find((e) => e.event === 'film_link_pasted');
    expect(event?.data?.host).toBe('www.youtube.com');
    // Recording a link does not start processing.
    expect(state.filmSource).toBeNull();
  });

  it('abstains on the degraded snap, says what would make it gradable, and needs a reason to accept No Grade', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await openPlay(user, 6);

    expect(screen.getByText(/Film quality: Poor/i)).toBeInTheDocument();
    expect(screen.getByTestId('would-enable')).toHaveTextContent(
      /end-zone copy of this snap, or any fixed angle without the zoom push/i,
    );
    await user.click(screen.getByRole('button', { name: /Accept candidate \(No Grade\)/i }));
    expect(screen.queryByTestId('decision-recorded')).not.toBeInTheDocument();
    expect(screen.getByTestId('decision-pending')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Film quality too poor/i }));
    await screen.findByTestId('decision-recorded');

    const decision = stored().decisions['play-6'];
    expect(decision.action).toBe('accepted');
    expect(decision.finalGrade).toBe('NG');
    expect(decision.reasonCodes).toEqual(['film_quality']);
  });

  it('accepts a graded candidate without a reason and updates progress and coverage', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await openPlay(user, 1);
    await acceptCandidate(user);
    await backToQueue(user);

    expect(screen.getByTestId('coverage-progress')).toHaveTextContent(
      '1 of 6 reviewed · 1 graded · 0 No Grade',
    );
    const decision = Object.values(stored().decisions)[0];
    expect(decision.action).toBe('accepted');
    expect(decision.finalGrade).toBe(3);
    expect(decision.reasonCodes).toEqual([]);
    expect(decision.revision).toBe(1);
  });

  it('lets the coach navigate evidence frames and highlights the selected evidence', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await openPlay(user, 1);

    // The first evidence frame is selected on open.
    expect(screen.getByTestId('frame-caption')).toHaveTextContent(/Pre-snap alignment matches/i);
    await user.click(screen.getByRole('button', { name: /Defender displaced past the original track/i }));
    expect(screen.getByTestId('frame-caption')).toHaveTextContent(/Defender displaced/i);
    expect(screen.getByRole('button', { name: /Result 00:13\.6/i })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Previous frame/i }));
    expect(screen.getByTestId('frame-caption')).toHaveTextContent(/inside hand placed/i);
  });

  it('requires a structured reason to change a grade and does it in two interactions', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await openPlay(user, 2);

    // Interaction 1: pick the new grade. Reasons appear in the same step.
    await user.click(screen.getByRole('button', { name: /Change to Grade 1/i }));
    expect(screen.queryByTestId('decision-recorded')).not.toBeInTheDocument();
    expect(screen.getByText(/Pick one reason to record the change/i)).toBeInTheDocument();

    // Interaction 2: pick the reason. The decision is now recorded.
    await user.click(screen.getByRole('button', { name: /^Pad level or leverage$/i }));
    await screen.findByTestId('decision-recorded');

    const decision = stored().decisions['play-2'];
    expect(decision.action).toBe('changed');
    expect(decision.finalGrade).toBe(1);
    expect(decision.candidateGrade).toBe(2);
    expect(decision.reasonCodes).toEqual(['pad_level']);
  });

  it('lets the coach revise a saved decision and counts the revision', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await openPlay(user, 2);
    await acceptCandidate(user);
    await user.click(screen.getByRole('button', { name: /Change to Grade 3/i }));
    await user.click(screen.getByRole('button', { name: /AI misread the assignment/i }));
    await waitFor(() => expect(stored().decisions['play-2'].finalGrade).toBe(3));
    expect(stored().decisions['play-2'].revision).toBe(2);
    expect(screen.getByTestId('decision-recorded')).toHaveTextContent(/revised/i);
  });

  it('records a coach No Grade with a structured reason', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await openPlay(user, 5);

    await user.click(screen.getByRole('button', { name: /Mark No Grade/i }));
    expect(screen.queryByTestId('decision-recorded')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Camera angle insufficient/i }));
    await screen.findByTestId('decision-recorded');

    const decision = stored().decisions['play-5'];
    expect(decision.action).toBe('no_grade');
    expect(decision.finalGrade).toBe('NG');
    expect(decision.reasonCodes).toEqual(['camera_angle']);

    await backToQueue(user);
    expect(screen.getByTestId('coverage-progress')).toHaveTextContent(
      '1 of 6 reviewed · 0 graded · 1 No Grade',
    );
  });

  it('withholds the Play 4 candidate until a blind grade is submitted and stores both', async () => {
    const user = userEvent.setup();
    await toQueue(user);

    const row = screen.getByRole('row', { name: /^Play 4\b/ });
    expect(within(row).getByText(/Not yet reviewed — your grade first/i)).toBeInTheDocument();
    expect(within(row).getAllByText(/Withheld/i).length).toBe(2);

    await openPlay(user, 4);
    expect(screen.queryByRole('heading', { name: /Simulated AI candidate/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Candidate evidence/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/missed play-side responsibility/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Before you see the system/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Grade 2$/ }));
    await user.click(screen.getByRole('button', { name: /Submit my grade and reveal/i }));

    expect(await screen.findByRole('heading', { name: /Simulated AI candidate/i })).toBeInTheDocument();
    expect(stored().blindGrades['play-4']).toBe(2);

    // Keep the coach grade: change the candidate (Grade 1) back to the coach's Grade 2.
    await user.click(screen.getByRole('button', { name: /Change to Grade 2/i }));
    await user.click(screen.getByRole('button', { name: /^Hand placement$/i }));
    await screen.findByTestId('decision-recorded');

    const decision = stored().decisions['play-4'];
    expect(decision.blindGrade).toBe(2);
    expect(decision.candidateGrade).toBe(1);
    expect(decision.finalGrade).toBe(2);
    expect(decision.movedTowardCandidate).toBe(false);
  });

  it('shows an insufficient-evidence state when every reviewed play is No Grade', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      await openPlay(user, n);
      if (n === 4) {
        await user.click(screen.getByRole('button', { name: /^No Grade$/ }));
        await user.click(screen.getByRole('button', { name: /Submit my grade and reveal/i }));
        await screen.findByRole('heading', { name: /Simulated AI candidate/i });
      }
      if (n === 3 || n === 6) {
        await acceptCandidate(user, /Player not visible/i);
      } else {
        await user.click(screen.getByRole('button', { name: /Mark No Grade/i }));
        await user.click(screen.getByRole('button', { name: /Player not visible/i }));
        await screen.findByTestId('decision-recorded');
      }
      await backToQueue(user);
    }
    expect(screen.getByTestId('coverage-progress')).toHaveTextContent('6 of 6 reviewed · 0 graded · 6 No Grade');
    await user.click(screen.getByRole('button', { name: /Continue to practice focus/i }));
    expect(await screen.findByTestId('focus-insufficient')).toBeInTheDocument();
    expect(screen.getByTestId('focus-title')).toHaveTextContent(/Insufficient evidence/i);
    expect(screen.queryByRole('button', { name: /^Accept$/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('coverage-statement')).toHaveTextContent('Based on 0 coach-graded plays of 6 reviewed.');
  });

  it('invalidates an accepted practice focus when a decision changes', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await reviewAllSix(user);
    await user.click(screen.getByRole('button', { name: /Continue to practice focus/i }));
    await user.click(await screen.findByRole('button', { name: /^Accept$/ }));
    expect(screen.getByTestId('focus-state')).toHaveTextContent(/Recorded: accepted/);

    await user.click(screen.getByRole('button', { name: /Back to queue/i }));
    await openPlay(user, 1);
    await user.click(screen.getByRole('button', { name: /Change to Grade 2/i }));
    await user.click(screen.getByRole('button', { name: /^Finish$/i }));
    await screen.findByTestId('decision-recorded');
    await waitFor(() => expect(stored().recommendationState).toBe('stale'));
    expect(stored().events.map((e) => e.event)).toContain('recommendation_invalidated');

    await user.click(screen.getByRole('button', { name: /Continue to practice focus/i }));
    expect(await screen.findByTestId('focus-stale')).toBeInTheDocument();
    expect(screen.getByTestId('focus-state')).toHaveTextContent(/Stale/);
    await user.click(screen.getByRole('button', { name: /^Accept$/ }));
    await waitFor(() => expect(stored().recommendationState).toBe('accepted'));
  });

  it('produces a practice focus, coverage statement, research summary and JSON export', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await reviewAllSix(user);

    expect(screen.getByTestId('coverage-progress')).toHaveTextContent(
      '6 of 6 reviewed · 4 graded · 2 No Grade',
    );

    await user.click(screen.getByRole('button', { name: /Continue to practice focus/i }));

    expect(await screen.findByTestId('focus-title')).toHaveTextContent(
      /Hand placement during initial engagement/i,
    );
    expect(screen.getByTestId('coverage-statement')).toHaveTextContent(
      'Based on 4 coach-graded plays of 6 reviewed. Play 3, Play 6 were No Grade and are not included.',
    );
    expect(screen.getByTestId('focus-findings')).toHaveTextContent(/Play 2: Hand placement/);
    expect(screen.getByTestId('focus-findings')).toHaveTextContent(/Play 4: Hand placement/);
    expect(screen.getByTestId('focus-findings')).toHaveTextContent(/Play 5: Hand placement/);
    await user.click(screen.getByRole('button', { name: /^Accept$/i }));

    await user.click(screen.getByRole('button', { name: /Continue to research questions/i }));

    // The baseline is shown read-only and is not re-asked.
    expect(screen.getByTestId('baseline-readonly')).toHaveTextContent('20 minutes');
    expect(
      screen.queryByText(/How long does it normally take you to grade/i),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My earlier estimate was off/i })).toBeInTheDocument();

    // All six plays are decided, so the illustrative comparison is computed and labelled.
    expect(screen.getByTestId('timing-comparison')).toHaveTextContent(/minutes difference/);
    expect(screen.getByTestId('timing-comparison')).toHaveTextContent(/Illustrative comparison/);

    await user.click(screen.getAllByRole('radio', { name: 'Yes' })[0]);
    await user.click(screen.getByRole('radio', { name: '4' }));
    await user.click(screen.getByRole('button', { name: /Submit feedback/i }));

    await waitFor(() => expect(stored().feedback?.trustRating).toBe(4));

    expect(screen.getByTestId('summary-coverage')).toHaveTextContent('4 graded · 2 No Grade');
    expect(screen.getByTestId('summary-changed')).toHaveTextContent('Hand placement × 1');
    expect(screen.getByTestId('blind-comparison')).toHaveTextContent(/Coach first: Grade 2/);
    expect(screen.getByTestId('blind-comparison')).toHaveTextContent(/System candidate: Grade 1/);

    const state = stored();
    expect(state.recommendationState).toBe('accepted');
    expect(state.events.map((e) => e.event)).toEqual(
      expect.arrayContaining([
        'baseline_captured',
        'session_started',
        'demo_film_selected',
        'processing_completed',
        'play_opened',
        'blind_grade_submitted',
        'candidate_revealed',
        'candidate_accepted',
        'grade_changed',
        'recommendation_accepted',
        'feedback_submitted',
      ]),
    );
  }, 30000);

  it('does not compute the timing comparison for a partial session', async () => {
    const user = userEvent.setup();
    await toQueue(user);
    await openPlay(user, 1);
    await acceptCandidate(user);
    await backToQueue(user);
    // Jump to the summary through the practice focus is not possible without all six;
    // seed the screen directly through the stored state instead.
    const state = stored();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, screen: 'summary' }));
    // Re-render from storage: a saved session lands on the landing page and is resumed.
    const { unmount } = render(<App />);
    await user.click(screen.getAllByRole('button', { name: /Resume your session/i })[0]);
    expect(screen.getAllByTestId('timing-comparison')[0]).toHaveTextContent(/Not computed/);
    expect(screen.getAllByTestId('timing-comparison')[0]).toHaveTextContent(/1 of 6 plays/);
    unmount();
  });
});
