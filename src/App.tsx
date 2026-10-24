import { useEffect, useRef, useState } from 'react';
import { SessionProvider, useSession } from './state/SessionContext';
import { Stepper } from './components/Stepper';
import { AccuracyNote } from './components/Indicators';
import { ACCURACY_STATEMENT, DEMO_NOTE } from './data/team';
import { LandingScreen } from './screens/LandingScreen';
import { IntroScreen } from './screens/IntroScreen';
import { TeamContextScreen } from './screens/TeamContextScreen';
import { FilmScreen } from './screens/FilmScreen';
import { ReviewQueueScreen } from './screens/ReviewQueueScreen';
import { PlayReviewScreen } from './screens/PlayReviewScreen';
import { PracticeFocusScreen } from './screens/PracticeFocusScreen';
import { ResearchSummaryScreen } from './screens/ResearchSummaryScreen';
import type { SessionState } from './types';
import { parseHash, syncHash } from './utils/routes';

function SessionTimer({ startedAtMs }: { startedAtMs: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAtMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAtMs]);
  if (!startedAtMs) return <span className="timer">Timer starts at Begin Review</span>;
  const secs = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return (
    <span className="timer" aria-label="Session elapsed time">
      Session {mm}:{ss}
    </span>
  );
}

function Shell() {
  const { state, dispatch } = useSession();
  const latest = useRef(state);
  latest.current = state;

  // Keep focus and scroll predictable when the screen changes.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    const main = document.getElementById('main');
    if (main) main.focus({ preventScroll: true });
  }, [state.screen, state.activePlayId]);

  // Keep the URL hash in step with the entry point (#/, #/demo, #/research) so a deep
  // link can be copied. The hash is read on load; it is never a router.
  useEffect(() => {
    syncHash(state);
  }, [state.screen, state.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // A hash typed after load (or Back/Forward) applies only when nothing would be lost;
  // otherwise the hash is put back to match the session. replaceState never fires this.
  useEffect(() => {
    function onHashChange() {
      dispatch({ type: 'applyRoute', route: parseHash(window.location.hash) });
      // If the route could not be applied the state is unchanged; re-sync the hash so the
      // URL never claims a mode the session is not in.
      setTimeout(() => syncHash(latest.current), 0);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [dispatch]);

  const landing = state.screen === 'landing';

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <span className="wordmark">
          Football<span>OS</span>
        </span>
        <span className="proto-tag">Prototype · simulated AI</span>
        <AccuracyNote />
        {state.mode === 'demo' && (
          <span className="demo-note" data-testid="header-demo-note">
            {DEMO_NOTE}
          </span>
        )}
        <SessionTimer startedAtMs={state.startedAtMs} />
      </header>
      {state.screen === 'intro' ? (
        // Research entry: one neutral line, no examples and nothing about grades or confidence.
        <div className="sim-banner" role="note" data-testid="sim-banner">
          <strong>Prototype.</strong> This tool calls no model and analyzes no video. Nothing you
          enter leaves this browser.
        </div>
      ) : (
        <details className="sim-banner" role="note" data-testid="sim-banner">
          <summary>
            <strong>Simulated AI.</strong> Every candidate grade, confidence label and evidence
            note is authored mock data. The coach makes every final decision.{' '}
            <span className="sim-more">More</span>
          </summary>
          <ul className="small">
            <li>No video is processed and no model is called, at any point, for any file or link.</li>
            <li>
              Confidence labels are authored, illustrative values, not calibrated probabilities.{' '}
              {ACCURACY_STATEMENT}
            </li>
            <li>
              The practice focus is composed deterministically from the coach&rsquo;s own decisions.
              It is not coaching guidance from any outside source.
            </li>
            <li>
              Research instrumentation (baseline, review timing, reasons, feedback, export) is real
              and stays in this browser.{' '}
              {state.mode === 'demo'
                ? 'This is a demo session: no baseline is collected and the export is marked demo.'
                : ''}
            </li>
          </ul>
        </details>
      )}
      {!landing && <Stepper current={state.screen} />}
      <main id="main" tabIndex={-1}>
        {landing && <LandingScreen />}
        {state.screen === 'intro' && <IntroScreen />}
        {state.screen === 'team' && <TeamContextScreen />}
        {state.screen === 'film' && <FilmScreen />}
        {state.screen === 'queue' && <ReviewQueueScreen />}
        {state.screen === 'review' && <PlayReviewScreen />}
        {state.screen === 'focus' && <PracticeFocusScreen />}
        {state.screen === 'summary' && <ResearchSummaryScreen />}
      </main>
      <footer className="app-footer">
        <span>Winchester Hawks is a fictional program. Research data stays in this browser.</span>
        <span>Session {state.sessionId}</span>
      </footer>
    </div>
  );
}

export default function App({ seed }: { seed?: SessionState }) {
  return (
    <SessionProvider seed={seed}>
      <Shell />
    </SessionProvider>
  );
}
