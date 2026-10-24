import { useState } from 'react';
import { useSession } from '../state/SessionContext';
import { TEAM } from '../data/team';
import { PLAYS } from '../data/plays';

const METHODS = [
  'Hudl or a similar video platform',
  'Film plus paper or a spreadsheet',
  'Film only, no separate notes',
  'Other',
];

const RANGES = [5, 10, 15, 20, 30, 45];

export function IntroScreen() {
  const { dispatch } = useSession();
  const [minutes, setMinutes] = useState<string>('');
  const [method, setMethod] = useState<string>('');
  const [otherMethod, setOtherMethod] = useState('');
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [methodError, setMethodError] = useState<string | null>(null);

  const resolvedMethod = method === 'Other' ? `Other: ${otherMethod || 'unspecified'}` : method;

  function begin() {
    const parsed = Number(minutes);
    let ok = true;
    if (!minutes || Number.isNaN(parsed) || parsed <= 0) {
      setMinutesError('Enter an approximate number of minutes before beginning.');
      ok = false;
    } else {
      setMinutesError(null);
    }
    if (!method) {
      setMethodError('Select how you normally grade film today.');
      ok = false;
    } else {
      setMethodError(null);
    }
    if (!ok) return;
    dispatch({
      type: 'captureBaseline',
      baseline: { minutesForSixSnaps: parsed, method: resolvedMethod },
    });
    dispatch({ type: 'begin' });
  }

  return (
    <>
      <section className="hero" aria-labelledby="intro-heading">
        <h1 id="intro-heading">FootballOS</h1>
        <p className="lede">
          An AI-assisted coaching workspace for high-school football programs. It helps a
          position coach turn game film and the team&rsquo;s own standards into faster review
          decisions and a usable practice focus &mdash; with the coach making every final call.
        </p>
        <div className="hero-grid">
          <div className="hero-item">
            <strong>What it helps you do</strong>
            See a first-pass grade for each snap, check the evidence behind it, and accept or
            correct it in two taps.
          </div>
          <div className="hero-item">
            <strong>What you can try</strong>
            {PLAYS.length} {TEAM.concept} snaps for {TEAM.primaryPlayer}, from a fictional
            program, the {TEAM.program}.
          </div>
          <div className="hero-item">
            <strong>What is simulated</strong>
            Every grade, confidence label, and evidence note is authored mock data. No video is
            analyzed and no model is called.
          </div>
          <div className="hero-item">
            <strong>Who decides</strong>
            You do. Accept, change, or mark No Grade. The practice focus is built only from
            your decisions.
          </div>
        </div>
      </section>

      <section className="card">
        <h2>The task</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Workflow</th>
              <td>
                Select film &rarr; inspect a proposed evaluation &rarr; review evidence and
                uncertainty &rarr; accept or correct it &rarr; create a practice focus from
                your reviewed findings.
              </td>
            </tr>
            <tr>
              <th scope="row">Expected length</th>
              <td>About 10 minutes for {PLAYS.length} snaps, plus a short feedback form.</td>
            </tr>
            <tr>
              <th scope="row">What is recorded</th>
              <td>
                Your decisions, timing, and feedback. Research data stays in this browser; nothing
                is sent anywhere. <strong>Please do not enter names, player details, school
                details, or any other personal information.</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card" aria-labelledby="baseline-heading">
        <h2 id="baseline-heading">Before you start &mdash; your baseline</h2>
        <p className="small muted">
          We ask this first, before you see the review workflow, so the estimate reflects your
          normal week rather than what you just experienced.
        </p>

        <fieldset>
          <legend>
            Approximately how long does it normally take you to grade {PLAYS.length}{' '}
            offensive-line snaps from game film?
          </legend>
          <label htmlFor="baseline-minutes">Minutes (approximate)</label>
          <input
            id="baseline-minutes"
            type="number"
            min={1}
            max={600}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-describedby="baseline-help"
            aria-invalid={minutesError ? 'true' : undefined}
          />
          <div id="baseline-help" className="small muted" style={{ marginTop: 6 }}>
            Or pick a rough range:
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            {RANGES.map((r) => (
              <button
                type="button"
                key={r}
                className="chip"
                aria-pressed={minutes === String(r)}
                onClick={() => setMinutes(String(r))}
              >
                {r} min
              </button>
            ))}
          </div>
          {minutesError && (
            <p role="alert" className="field-error">
              {minutesError}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>How do you normally do it today?</legend>
          <div className="btn-row">
            {METHODS.map((m) => (
              <button
                type="button"
                key={m}
                className="chip"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
              >
                {m}
              </button>
            ))}
          </div>
          {method === 'Other' && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor="method-other">Tell us briefly (no personal details)</label>
              <input
                id="method-other"
                type="text"
                value={otherMethod}
                onChange={(e) => setOtherMethod(e.target.value)}
              />
            </div>
          )}
          {methodError && (
            <p role="alert" className="field-error">
              {methodError}
            </p>
          )}
        </fieldset>

        <div className="btn-row">
          <button type="button" className="primary" onClick={begin}>
            Begin Review
          </button>
          <span className="small muted">The session timer starts when you begin.</span>
        </div>
      </section>
    </>
  );
}
