import { useMemo, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { buildSummary, sessionJson, TIMING_DEFINITIONS } from '../utils/summary';
import { ACCURACY_STATEMENT, DEMO_NOTE, gradeShort } from '../data/team';
import { AccuracyNote } from '../components/Indicators';
import type { Feedback } from '../types';

const SCALE = ['Yes', 'Partly', 'No'];

const QUESTIONS: { key: keyof Feedback; label: string }[] = [
  { key: 'evidenceUnderstandable', label: 'Was the evidence easy to understand?' },
  {
    key: 'confidenceUnderstandable',
    label: 'Were the two confidence readings understandable?',
  },
  {
    key: 'gradeOneVsNoGradeClear',
    label: 'Was the difference between a Grade 1 and a No Grade clear?',
  },
  { key: 'correctionEasy', label: 'Was correcting a grade easy?' },
  {
    key: 'reasonsMatchThinking',
    label: 'Did the reason options match how you actually think about mistakes?',
  },
  { key: 'practiceFocusUseful', label: 'Was the practice focus useful?' },
  {
    key: 'wouldUseGameWeek',
    label: 'Would you use this workflow during a normal game week?',
  },
  { key: 'appearedToSaveTime', label: 'Did the prototype appear to save time?' },
];

const EMPTY: Feedback = {
  evidenceUnderstandable: '',
  confidenceUnderstandable: '',
  gradeOneVsNoGradeClear: '',
  correctionEasy: '',
  reasonsMatchThinking: '',
  practiceFocusUseful: '',
  wouldUseGameWeek: '',
  appearedToSaveTime: '',
  trustRating: null,
  remainingConcerns: '',
  comments: '',
  willingToTest: '',
};

export function ResearchSummaryScreen() {
  const { state, dispatch } = useSession();
  const [form, setForm] = useState<Feedback>(state.feedback ?? EMPTY);
  const [revising, setRevising] = useState(false);
  const [revised, setRevised] = useState('');
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [confirmReset, setConfirmReset] = useState(false);
  const summary = useMemo(() => buildSummary(state), [state]);
  const json = useMemo(() => sessionJson(state), [state]);

  function set<K extends keyof Feedback>(key: K, value: Feedback[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function copyResults() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  }

  function download() {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `footballos-session-${state.sessionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    dispatch({ type: 'log', event: 'session_exported' });
  }

  return (
    <>
      {state.mode === 'demo' && (
        <div className="callout gold" role="note" data-testid="summary-demo-note">
          <strong>{DEMO_NOTE}</strong> No baseline was collected and no participant was
          involved. The export below carries <span className="mono">mode: &quot;demo&quot;</span>{' '}
          so it can never be mixed with research sessions.
        </div>
      )}
      <section className="card" aria-labelledby="feedback-heading">
        <h1 id="feedback-heading">Research questions</h1>
        <p className="small muted">
          Please answer as the coach who would use this. No names or personal details are
          collected &mdash; please do not add any in the text fields.
        </p>

        {QUESTIONS.map((q) => (
          <fieldset key={q.key}>
            <legend>{q.label}</legend>
            <div className="radio-row">
              {SCALE.map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name={q.key}
                    value={option}
                    checked={form[q.key] === option}
                    onChange={() => set(q.key, option as Feedback[typeof q.key])}
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset>
          <legend>
            How much would you trust this workflow as a first pass? (1 = not at all, 5 = fully)
          </legend>
          <div className="radio-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n}>
                <input
                  type="radio"
                  name="trustRating"
                  value={n}
                  checked={form.trustRating === n}
                  onChange={() => set('trustRating', n)}
                />
                {n}
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="remaining-concerns">
          What would stop you from trusting or using this? (optional)
        </label>
        <textarea
          id="remaining-concerns"
          value={form.remainingConcerns}
          onChange={(e) => set('remainingConcerns', e.target.value)}
        />

        <fieldset style={{ marginTop: 12 }}>
          <legend>Would you be willing to test this with your program? (optional)</legend>
          <div className="radio-row">
            {['Yes', 'Maybe', 'No'].map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="willingToTest"
                  value={option}
                  checked={form.willingToTest === option}
                  onChange={() => set('willingToTest', option)}
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>

        <label htmlFor="comments">Comments (optional)</label>
        <textarea
          id="comments"
          value={form.comments}
          onChange={(e) => set('comments', e.target.value)}
        />

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="primary"
            onClick={() => dispatch({ type: 'submitFeedback', feedback: form })}
          >
            Submit feedback
          </button>
          <span className="small muted" role="status">
            {state.feedback ? 'Feedback recorded. Submitting again replaces it.' : ''}
          </span>
        </div>
      </section>

      <section className="card">
        <h2>Your baseline (captured before the task)</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Estimated time for six comparable snaps</th>
              <td data-testid="baseline-readonly">
                {state.baseline?.minutesForSixSnaps ?? '—'} minutes
              </td>
            </tr>
            <tr>
              <th scope="row">Normal method</th>
              <td>{state.baseline?.method ?? '—'}</td>
            </tr>
            <tr>
              <th scope="row">Captured</th>
              <td className="small muted">
                {state.baseline?.timestamp ?? '—'} (before any exposure to the workflow)
              </td>
            </tr>
            {state.baselineRevision && (
              <tr>
                <th scope="row">Revised estimate</th>
                <td>
                  {state.baselineRevision.minutesForSixSnaps} minutes ·{' '}
                  <span className="small muted">original estimate retained above</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="btn-row">
          <button type="button" className="link" onClick={() => setRevising((r) => !r)}>
            My earlier estimate was off
          </button>
        </div>
        {revising && (
          <div style={{ marginTop: 8 }}>
            <label htmlFor="revised-minutes">Revised estimate (minutes)</label>
            <input
              id="revised-minutes"
              type="number"
              min={1}
              value={revised}
              onChange={(e) => setRevised(e.target.value)}
            />
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  const n = Number(revised);
                  if (n > 0) {
                    dispatch({ type: 'reviseBaseline', minutes: n });
                    setRevising(false);
                  }
                }}
              >
                Save revision (both values are kept)
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Session summary</h2>
        <table>
          <tbody>
            <tr>
              <th scope="row">Plays reviewed</th>
              <td>
                {summary.playsReviewed} of {summary.playsTotal}
              </td>
            </tr>
            <tr>
              <th scope="row">Coverage</th>
              <td data-testid="summary-coverage">
                {summary.playsGraded} graded · {summary.playsNoGrade} No Grade
                <br />
                <span className="small muted">
                  Coverage is how many plays could be assessed, not whether the assessments are
                  correct.
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row">Candidates accepted</th>
              <td>
                {summary.accepted}
                <br />
                <span className="small muted">
                  Coach agreement is not accuracy. {ACCURACY_STATEMENT}
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row">Candidates changed</th>
              <td data-testid="summary-changed">
                {summary.changed}
                {summary.changeReasonBreakdown.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {summary.changeReasonBreakdown.map((r) => (
                      <li key={r.code}>
                        {r.label} × {r.count}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
            <tr>
              <th scope="row">No Grade decisions</th>
              <td>
                {summary.playsNoGrade}{' '}
                <span className="small muted">
                  ({summary.coachNoGrade} marked by you, {summary.playsNoGrade - summary.coachNoGrade} accepted from the candidate)
                </span>
                {summary.noGradeReasonBreakdown.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {summary.noGradeReasonBreakdown.map((r) => (
                      <li key={r.code}>
                        {r.label} × {r.count}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
            {summary.blindComparison && (
              <tr>
                <th scope="row">Blind-first comparison (Play {summary.blindComparison.playNumber})</th>
                <td data-testid="blind-comparison">
                  Coach first:{' '}
                  {summary.blindComparison.blindGrade
                    ? gradeShort(summary.blindComparison.blindGrade)
                    : '—'}{' '}
                  · System candidate: {gradeShort(summary.blindComparison.candidateGrade)} · Final:{' '}
                  {summary.blindComparison.finalGrade
                    ? gradeShort(summary.blindComparison.finalGrade)
                    : '—'}
                  {summary.blindComparison.movedTowardCandidate !== null && (
                    <>
                      {' '}
                      ·{' '}
                      {summary.blindComparison.movedTowardCandidate
                        ? 'Moved toward the candidate after reveal'
                        : 'Did not move toward the candidate'}
                    </>
                  )}
                  <br />
                  <span className="small muted">
                    An exploratory signal about reliance on one play. Not a validated measure of
                    accuracy or bias.
                  </span>
                </td>
              </tr>
            )}
            <tr>
              <th scope="row">Trust rating</th>
              <td>{summary.trustRating ?? 'Not yet submitted'}</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: 16 }}>Timing</h3>
        <table>
          <tbody>
            <tr>
              <th scope="row">Baseline estimate</th>
              <td>{summary.baselineMinutes ?? '—'} minutes</td>
            </tr>
            <tr>
              <th scope="row">Measured review time</th>
              <td>
                {summary.measuredReviewMinutes} minutes across {summary.playsReviewed} reviewed
                plays (average {summary.averageReviewSeconds} seconds per play)
              </td>
            </tr>
            <tr>
              <th scope="row">Session elapsed</th>
              <td>{summary.sessionElapsedMinutes ?? '—'} minutes</td>
            </tr>
            <tr>
              <th scope="row">Illustrative comparison</th>
              <td data-testid="timing-comparison">
                {summary.comparison.comparable
                  ? `${summary.comparison.illustrativeDifferenceMinutes} minutes difference between the baseline and measured review time.`
                  : 'Not computed.'}{' '}
                <span className="small muted">{summary.comparison.reason}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <details style={{ marginTop: 8 }}>
          <summary className="small">What each timing measure includes</summary>
          <dl className="definition-list">
            <dt>Baseline estimate</dt>
            <dd>{TIMING_DEFINITIONS.baselineMinutes}</dd>
            <dt>Measured review time</dt>
            <dd>{TIMING_DEFINITIONS.measuredReviewMinutes}</dd>
            <dt>Session elapsed</dt>
            <dd>{TIMING_DEFINITIONS.sessionElapsedMinutes}</dd>
            <dt>Illustrative comparison</dt>
            <dd>{TIMING_DEFINITIONS.illustrativeDifferenceMinutes}</dd>
          </dl>
        </details>

        <p className="small muted" style={{ marginTop: 10 }}>
          <AccuracyNote inline /> Nothing on this screen measures how often a model would be
          right.
        </p>

        <div className="btn-row" style={{ marginTop: 12 }}>
          <button type="button" onClick={copyResults}>
            Copy Results
          </button>
          <button type="button" onClick={download}>
            Download Session JSON
          </button>
          {!confirmReset ? (
            <button type="button" className="danger" onClick={() => setConfirmReset(true)}>
              Reset session
            </button>
          ) : (
            <>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setConfirmReset(false);
                  dispatch({ type: 'restart' });
                }}
              >
                Yes, clear everything and start over
              </button>
              <button type="button" onClick={() => setConfirmReset(false)}>
                Keep my session
              </button>
            </>
          )}
          <span className="small muted" role="status">
            {copied === 'ok' && 'Copied to clipboard. '}
            {copied === 'failed' && 'Clipboard unavailable — use Download instead. '}
            {confirmReset &&
              'Reset clears every stored decision, timing and feedback in this browser. Export first if you want to keep it.'}
          </span>
        </div>
      </section>

      <section className="card">
        <details className="research-log">
          <summary>Research Log ({state.events.length} events)</summary>
          <p className="small muted">
            Local research data only: event names, prototype-relative timings, play IDs, and your
            decisions. Stored in this browser under{' '}
            <span className="mono">footballos.prototype.v2</span>. Pasted links are reduced to
            their host; nothing else is kept.
          </p>
          <pre className="log">{json}</pre>
        </details>
      </section>
    </>
  );
}
