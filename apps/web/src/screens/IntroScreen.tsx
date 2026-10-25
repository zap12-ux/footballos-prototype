import { useState } from 'react';
import { useSession } from '../state/SessionContext';
import { PLAYS } from '../data/plays';
import { TEAM } from '../data/team';

/**
 * Research entry screen (Screen 1 of the research flow).
 *
 * Collects the baseline BEFORE anything about the review workflow is shown: no candidate
 * grades, no confidence labels, no evidence examples, no suggested completion time, and no
 * numeric anchors for the estimate. The wording stays neutral about the product. A coach
 * who does not know their time can say so; a missing estimate is recorded as missing.
 */

const METHODS = [
  'Hudl or a similar video platform',
  'Film plus paper or a spreadsheet',
  'Film only, no separate notes',
  'Other',
];

const EXPOSURE_OPTIONS: { value: 'no' | 'yes' | 'not_sure'; label: string }[] = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
  { value: 'not_sure', label: 'Not sure' },
];

export function IntroScreen() {
  const { state, dispatch } = useSession();
  const [minutes, setMinutes] = useState<string>('');
  const [notSure, setNotSure] = useState(false);
  const [method, setMethod] = useState<string>('');
  const [otherMethod, setOtherMethod] = useState('');
  const [exposure, setExposure] = useState<'no' | 'yes' | 'not_sure' | null>(null);
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [methodError, setMethodError] = useState<string | null>(null);
  const [exposureError, setExposureError] = useState<string | null>(null);

  const resolvedMethod = method === 'Other' ? `Other: ${otherMethod || 'unspecified'}` : method;
  const viaLanding = state.researchEntry === 'landing_page';

  function begin() {
    const parsed = Number(minutes);
    let ok = true;
    if (!notSure && (!minutes.trim() || Number.isNaN(parsed) || parsed <= 0)) {
      setMinutesError('Enter a number of minutes, or choose “I’m not sure”.');
      ok = false;
    } else {
      setMinutesError(null);
    }
    if (!method) {
      setMethodError('Select how you grade film today.');
      ok = false;
    } else {
      setMethodError(null);
    }
    if (!exposure) {
      setExposureError('Choose one answer.');
      ok = false;
    } else {
      setExposureError(null);
    }
    if (!ok || !exposure) return;
    dispatch({
      type: 'captureBaseline',
      baseline: {
        minutesForSixSnaps: notSure ? null : parsed,
        estimateStatus: notSure ? 'not_sure' : 'provided',
        method: resolvedMethod,
        selfReportedPriorExposure: exposure,
      },
    });
    dispatch({ type: 'begin' });
  }

  return (
    <>
      <section className="card" aria-labelledby="intro-heading">
        <div className="card-head">
          <h1 id="intro-heading">Research session</h1>
          <span className="tag">Step 1 of 7 · before the task</span>
        </div>
        <p>
          You will review {PLAYS.length} offensive-line snaps from one game of a fictional
          program, the {TEAM.program}, using a prototype coaching tool, and then answer a short
          feedback form. Details of the tool come after these questions.
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Your answers, decisions and timing stay in this browser; nothing is sent anywhere.{' '}
          <strong>Please do not enter names, player details, school details, or any other
          personal information.</strong>
        </p>
      </section>

      <section className="card" aria-labelledby="baseline-heading">
        <h2 id="baseline-heading">Two questions before you start</h2>
        <p className="small muted">
          Asked first so your answers describe your normal week, not this session.
        </p>

        <fieldset>
          <legend>
            How long does it normally take you to grade {PLAYS.length} comparable offensive-line
            snaps from game film?
          </legend>
          <label htmlFor="baseline-minutes">Minutes</label>
          <div className="btn-row">
            <input
              id="baseline-minutes"
              type="number"
              min={1}
              max={600}
              inputMode="numeric"
              value={minutes}
              disabled={notSure}
              onChange={(e) => setMinutes(e.target.value)}
              aria-describedby="baseline-help"
              aria-invalid={minutesError ? 'true' : undefined}
              style={{ width: 120 }}
            />
            <button
              type="button"
              className="chip"
              aria-pressed={notSure}
              onClick={() => {
                setNotSure((v) => !v);
                setMinutesError(null);
              }}
            >
              I&rsquo;m not sure
            </button>
          </div>
          <div id="baseline-help" className="small muted" style={{ marginTop: 6 }}>
            Your own estimate, however rough. If you do not know, choose &ldquo;I&rsquo;m not
            sure&rdquo; and no number will be recorded.
          </div>
          {minutesError && (
            <p role="alert" className="field-error">
              {minutesError}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>How do you grade film today?</legend>
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

        <fieldset>
          <legend>Have you seen this prototype, or a demonstration of it, before today?</legend>
          <div className="radio-row">
            {EXPOSURE_OPTIONS.map((o) => (
              <label key={o.value}>
                <input
                  type="radio"
                  name="prior-exposure"
                  value={o.value}
                  checked={exposure === o.value}
                  onChange={() => setExposure(o.value)}
                />
                {o.label}
              </label>
            ))}
          </div>
          {viaLanding && (
            <p className="small muted" style={{ margin: '8px 0 0' }} data-testid="landing-exposure-note">
              You reached this page from the landing page, which shows example output. That is
              recorded with your answers.
            </p>
          )}
          {exposureError && (
            <p role="alert" className="field-error">
              {exposureError}
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
