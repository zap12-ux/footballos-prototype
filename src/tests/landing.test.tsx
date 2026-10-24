import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { STORAGE_KEY } from '../utils/storage';
import { buildSessionExport } from '../utils/summary';
import { initialState, reducer, resolveInitialState } from '../state/SessionContext';
import { parseHash, hashFor } from '../utils/routes';
import type { SessionState } from '../types';

function stored(): SessionState {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as SessionState;
}

function setHash(hash: string) {
  window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
}

describe('landing page and entry routes', () => {
  it('renders the landing page with both calls to action and the honesty line, and no baseline form', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /^FootballOS$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try the demo \(about 5 minutes\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start a research session/i })).toBeInTheDocument();

    const honesty = screen.getByTestId('honesty-line');
    expect(honesty).toHaveTextContent(/Simulated AI/);
    expect(honesty).toHaveTextContent(/No video is processed and no model is called/);
    expect(honesty).toHaveTextContent(/fictional program/);
    expect(honesty).toHaveTextContent(/Nothing you do here leaves this browser/);

    // The accuracy statement stays in the header on every route, including the landing page.
    expect(screen.getAllByText(/Model accuracy: not evaluated in this prototype/).length).toBeGreaterThan(0);
    // No research-intake form before the visitor has chosen a path.
    expect(screen.queryByLabelText(/Minutes \(approximate\)/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Begin Review/i })).not.toBeInTheDocument();
    // Nothing quantitative: no percentage anywhere on the landing page.
    expect(document.body.textContent).not.toMatch(/\d+\s?%/);
    expect(stored().screen).toBe('landing');
    expect(window.location.hash).toBe('#/');
  });

  it('shows the four AI-output cards with live components and frame-linked evidence', async () => {
    const user = userEvent.setup();
    render(<App />);
    const section = screen.getByRole('region', { name: /How the AI output is presented/i });
    expect(within(section).getByRole('heading', { name: /Candidate grade with rationale/i })).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: /Two confidence readings, kept separate/i })).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: /Evidence you can inspect/i })).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: /When the system declines to grade/i })).toBeInTheDocument();

    // Two separate confidence readings for the same play, never one merged score.
    expect(within(section).getByText(/Player identification confidence: High/)).toBeInTheDocument();
    expect(within(section).getByText(/Grade confidence: Medium/)).toBeInTheDocument();

    // Selecting an evidence item changes the diagram caption (live EvidencePanel + PlayDiagram).
    expect(screen.getByTestId('landing-frame-caption')).toHaveTextContent(/First movement: play-side step/i);
    await user.click(within(section).getByRole('button', { name: /Hands fit inside after the second step lands/i }));
    expect(screen.getByTestId('landing-frame-caption')).toHaveTextContent(/Hands fit inside/i);
    expect(screen.getByRole('img', { name: /frame 4 of 4/i })).toBeInTheDocument();

    // Abstention card: No Grade with its remedy.
    expect(within(section).getAllByText(/^No Grade$/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('landing-would-enable')).toHaveTextContent(/end-zone copy of this snap/i);
  });

  it('starts a demo from the landing page: no baseline prompt, mode demo, header note, hash #/demo', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Try the demo/i }));

    expect(await screen.findByRole('heading', { name: /Review queue/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Minutes \(approximate\)/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('film-check-banner')).toHaveTextContent(/4 of 6 snaps look gradable/);
    expect(screen.getByTestId('coverage-progress')).toHaveTextContent('0 of 6 reviewed · 0 graded · 0 No Grade');
    expect(screen.getByTestId('header-demo-note')).toHaveTextContent('Demo session — not research data.');

    const state = stored();
    expect(state.mode).toBe('demo');
    expect(state.baseline?.demo).toBe(true);
    expect(state.baseline?.minutesForSixSnaps).toBeNull();
    expect(state.filmSource).toBe('demo');
    expect(state.events.map((e) => e.event)).toContain('demo_started');
    expect(window.location.hash).toBe('#/demo');
  });

  it('#/demo deep link reaches the review queue without a baseline prompt', async () => {
    setHash('#/demo');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /Review queue/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Minutes \(approximate\)/i)).not.toBeInTheDocument();
    expect(stored().mode).toBe('demo');
    expect(stored().screen).toBe('queue');
  });

  it('#/research deep link shows the baseline form and keeps the gating', async () => {
    const user = userEvent.setup();
    setHash('#/research');
    render(<App />);
    expect(screen.getByLabelText(/Minutes \(approximate\)/i)).toBeInTheDocument();
    expect(stored().mode).toBe('research');
    expect(window.location.hash).toBe('#/research');

    // Gating is unchanged: Begin Review is blocked until the baseline is complete.
    await user.click(screen.getByRole('button', { name: /Begin Review/i }));
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(stored().baseline ?? null).toBeNull();
    expect(screen.queryByRole('heading', { name: /Team context/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('header-demo-note')).not.toBeInTheDocument();
  });

  it('demo mode behaves like the real workflow: a decision, the demo note on the summary, and mode in the export', async () => {
    const user = userEvent.setup();
    setHash('#/demo');
    render(<App />);
    await screen.findByRole('heading', { name: /Review queue/i });

    const row = screen.getByRole('row', { name: /^Play 2\b/ });
    await user.click(within(row).getByRole('button', { name: /Review Play 2/i }));
    // Two-interaction correction with a required reason still applies in demo mode.
    await user.click(screen.getByRole('button', { name: /Change to Grade 1/i }));
    expect(screen.getByTestId('decision-pending')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Hand placement$/i }));
    await screen.findByTestId('decision-recorded');
    expect(stored().decisions['play-2'].reasonCodes).toEqual(['hand_placement']);

    // Jump to the results screen as the saved demo session and check the note and the export.
    const seeded: SessionState = { ...stored(), screen: 'summary' };
    const first = render(<App seed={seeded} />);
    expect(screen.getAllByTestId('summary-demo-note')[0]).toHaveTextContent('Demo session — not research data.');
    first.unmount();

    const exported = buildSessionExport(seeded);
    expect(exported.mode).toBe('demo');
    expect(exported.modeNote).toMatch(/not research data/);
    expect(exported.baseline?.demo).toBe(true);
    expect(exported.summary.comparison.comparable).toBe(false);
    expect(exported.summary.comparison.reason).toMatch(/No baseline was captured/);
    expect(JSON.stringify(exported)).not.toMatch(/\d+\s?%/);
  });

  it('a saved session is resumable from the landing page and a deep link never destroys it', async () => {
    const user = userEvent.setup();
    const session = render(<App />);
    await user.click(screen.getByRole('button', { name: /Try the demo/i }));
    await screen.findByRole('heading', { name: /Review queue/i });
    const row = screen.getByRole('row', { name: /^Play 1\b/ });
    await user.click(within(row).getByRole('button', { name: /Review Play 1/i }));
    await user.click(screen.getByRole('button', { name: /Accept candidate/i }));
    await screen.findByTestId('decision-recorded');
    const sessionId = stored().sessionId;
    session.unmount();

    // Reload with the #/demo deep link: the saved session is kept and offered for resumption.
    setHash('#/demo');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /^FootballOS$/ })).toBeInTheDocument();
    expect(screen.getByTestId('landing-resume')).toHaveTextContent(/saved session/i);
    expect(stored().sessionId).toBe(sessionId);

    await user.click(screen.getByRole('button', { name: /Resume your session/i }));
    expect(await screen.findByRole('heading', { name: /Play and player/i })).toBeInTheDocument();
    expect(screen.getByTestId('decision-recorded')).toBeInTheDocument();
    expect(stored().sessionId).toBe(sessionId);
    expect(stored().events.map((e) => e.event)).toContain('session_resumed');
    expect(window.location.hash).toBe('#/demo');
  });

  it('a hash typed after load applies when nothing would be lost and never replaces a saved session', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Blank session: a typed #/demo starts the demo.
    window.location.hash = '#/demo';
    expect(await screen.findByRole('heading', { name: /Review queue/i })).toBeInTheDocument();
    expect(stored().mode).toBe('demo');

    // Record a decision so the session is no longer blank.
    const row = screen.getByRole('row', { name: /^Play 1\b/ });
    await user.click(within(row).getByRole('button', { name: /Review Play 1/i }));
    await user.click(screen.getByRole('button', { name: /Accept candidate/i }));
    await screen.findByTestId('decision-recorded');
    const sessionId = stored().sessionId;

    // #/ goes back to the landing page with the session resumable.
    window.location.hash = '#/';
    expect(await screen.findByRole('button', { name: /Resume your session/i })).toBeInTheDocument();
    expect(stored().resumeScreen).toBe('review');

    // #/research must not replace the saved demo session; the hash is put back.
    window.location.hash = '#/research';
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText(/Minutes \(approximate\)/i)).not.toBeInTheDocument();
    expect(stored().sessionId).toBe(sessionId);
    expect(window.location.hash).toBe('#/');

    // #/demo resumes the saved demo session instead of starting a new one.
    window.location.hash = '#/demo';
    expect(await screen.findByRole('heading', { name: /Play and player/i })).toBeInTheDocument();
    expect(stored().sessionId).toBe(sessionId);
  });

  it('starting a new session over a saved one asks for confirmation first', async () => {
    const user = userEvent.setup();
    setHash('#/demo');
    const session = render(<App />);
    await screen.findByRole('heading', { name: /Review queue/i });
    const row = screen.getByRole('row', { name: /^Play 1\b/ });
    await user.click(within(row).getByRole('button', { name: /Review Play 1/i }));
    await user.click(screen.getByRole('button', { name: /Accept candidate/i }));
    await screen.findByTestId('decision-recorded');
    const before = stored().sessionId;
    session.unmount();

    // Back to the landing page as a returning visitor.
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Start a research session/i }));
    // Not yet replaced.
    expect(stored().sessionId).toBe(before);
    expect(screen.getByText(/This replaces the saved session/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Keep my session/i }));
    expect(stored().sessionId).toBe(before);

    await user.click(screen.getByRole('button', { name: /Start a research session/i }));
    await user.click(screen.getByRole('button', { name: /Yes, start a new research session/i }));
    expect(screen.getByLabelText(/Minutes \(approximate\)/i)).toBeInTheDocument();
    expect(stored().sessionId).not.toBe(before);
    expect(stored().mode).toBe('research');
    expect(stored().decisions).toEqual({});
  });
});

describe('route helpers and reducer', () => {
  it('parses hashes and derives the hash from state', () => {
    expect(parseHash('')).toBe('landing');
    expect(parseHash('#/')).toBe('landing');
    expect(parseHash('#')).toBe('landing');
    expect(parseHash('#/demo')).toBe('demo');
    expect(parseHash('#/demo/')).toBe('demo');
    expect(parseHash('#/Research')).toBe('research');
    expect(parseHash('#/anything-else')).toBe('landing');

    const fresh = initialState();
    expect(fresh.screen).toBe('landing');
    expect(fresh.mode).toBe('research');
    expect(hashFor(fresh)).toBe('#/');
    const demo = reducer(fresh, { type: 'startDemo' });
    expect(hashFor(demo)).toBe('#/demo');
    const research = reducer(fresh, { type: 'startResearch' });
    expect(research.screen).toBe('intro');
    expect(hashFor(research)).toBe('#/research');
  });

  it('resolves the initial state from the saved session and the hash', () => {
    expect(resolveInitialState(null, '').screen).toBe('landing');
    expect(resolveInitialState(null, '#/demo').screen).toBe('queue');
    expect(resolveInitialState(null, '#/demo').mode).toBe('demo');
    expect(resolveInitialState(null, '#/research').screen).toBe('intro');

    // A blank saved session (nothing started) can be replaced by a deep link.
    const blank = { ...initialState(), screen: 'landing' as const };
    expect(resolveInitialState(blank, '#/demo').screen).toBe('queue');

    // A saved session with content lands on the landing page with a resume target.
    const inProgress = { ...reducer(initialState(), { type: 'startDemo' }), screen: 'review' as const };
    const resolved = resolveInitialState(inProgress, '#/demo');
    expect(resolved.screen).toBe('landing');
    expect(resolved.resumeScreen).toBe('review');
    expect(resolved.sessionId).toBe(inProgress.sessionId);
    const resumed = reducer(resolved, { type: 'resume' });
    expect(resumed.screen).toBe('review');
    expect(resumed.resumeScreen).toBeNull();
  });

  it('demo baseline satisfies gating but is flagged and never research data', () => {
    const demo = reducer(initialState(), { type: 'startDemo' });
    expect(demo.baseline).toMatchObject({ demo: true, capturedBeforeTask: true, minutesForSixSnaps: null });
    expect(demo.startedAtMs).toBeTruthy();
    expect(demo.filmSource).toBe('demo');
    expect(demo.events[0].event).toBe('demo_started');
    const research = reducer(initialState(), { type: 'startResearch' });
    expect(research.baseline).toBeNull();
    expect(research.mode).toBe('research');
  });
});
