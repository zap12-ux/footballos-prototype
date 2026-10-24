import { useEffect, useState } from 'react';
import { SessionProvider, useSession } from './state/SessionContext';
import { Stepper } from './components/Stepper';
import { AccuracyNote } from './components/Indicators';
import { DEMO_NOTE } from './data/team';
import { LandingScreen } from './screens/LandingScreen';
import { IntroScreen } from './screens/IntroScreen';
import { TeamContextScreen } from './screens/TeamContextScreen';
import { FilmScreen } from './screens/FilmScreen';
import { ReviewQueueScreen } from './screens/ReviewQueueScreen';
import { PlayReviewScreen } from './screens/PlayReviewScreen';
import { PracticeFocusScreen } from './screens/PracticeFocusScreen';
import { ResearchSummaryScreen } from './screens/ResearchSummaryScreen';
import type { SessionState } from './types';
import { syncHash } from './utils/routes';

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
  const { state } = useSession();

  // Keep focus and scroll predictable when the screen changes.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    const main = document.getElementById('main');
    if (main) main.focus({ preventScroll: true });
  }, [state.screen, state.activePlayId]);

  // Keep the URL hash in step with the entry point (#/, #/demo, #/research) so a deep
  // link can be copied. The hash is read once on load; it is never a router.
  useEffect(() => {
    syncHash(state);
  }, [state.screen, state.mode]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="sim-banner" role="note">
        Simulated AI. No video is processed and no model is called. Every candidate grade,
        confidence label and evidence note is authored mock data. The coach makes every final
        decision.
      </div>
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
