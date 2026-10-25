import { useMemo, useState } from 'react';
import { useSession } from '../state/SessionContext';
import {
  buildSummary,
  COMPARISON_SCOPE_NOTES,
  sessionJson,
  TIMING_DEFINITIONS,
} from '../utils/summary';
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

function yesNo(v: boolean): string {
  return v ? 'yes' : 'none recorded';
}

export function ResearchSummaryScreen() {
  const { state, dispatch } = useSession();
  const [form, setForm] = useState<Feedback>(state.feedback ?? EMPTY);
  const [revising, setRevising] = useState(false);
  const [revised, setRevised] = useState('');
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [confirmReset, setConfirmReset] = useState(false);
  const summary = useMemo(() => buildSummary(state), [state]);
  const json = useMemo(() => sessionJson(state), [state]);
  const demo = state.mode === 'demo';
  const baseline = demo ? null : state.baseline;
  const timing = summary.timing;

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
    a.download = `footballos-${state.mode}-session-${state.sessionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    dispatch({ type: 'log', event: 'session_exported' });
  }

  return (
    <>
      {demo && (
        <div className="callout gold" role="note" data-testid="summary-demo-note">
          <strong>{DEMO_NOTE}</strong> No baseline collected in demo mode and no participant was
          involved. The export below carries <span className="mono">mode: &quot;demo&quot;</span>{' '}
          and <span className="mono">baseline: null</span> so it can never be mixed with research
          sessions.
        </div>
      )}
      <section className="card" aria-labelledby="feedback-heading">
        <h1 id="feedback-heading">{demo ? 'Feedback' : 'Research questions'}</h1>
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

      {/* Baseline: research only. Demo sessions never had one and nothing is shown as if they did. */}
      <section className="card" data-testid="baseline-card">
        <h2>Your baseline</h2>
        {demo ? (
          <p data-testid="baseline-readonly" style={{ marginBottom: 0 }}>
            No baseline collected in demo mode.
          </p>
        ) : !baseline ? (
          <p data-testid="baseline-readonly" style={{ marginBottom: 0 }}>
            No baseline was captured in this session.
          </p>
        ) : (
          <>
            <table>
              <tbody>
                <tr>
                  <th scope="row">Estimated time for six comparable snaps</th>
                  <td data-testid="baseline-readonly">
                    {baseline.estimateStatus === 'provided' && baseline.minutesForSixSnaps !== null
                      ? `${baseline.minutesForSixSnaps} minutes`
                      : 'Not sure (no estimate recorded)'}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Normal method</th>
                  <td>{baseline.method || '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Captured</th>
                  <td className="small muted">
                    {baseline.timestamp || '—'} · before this review task started. This is not a
                    claim that you had never seen the prototype; known exposure is listed below.
                  </td>
                </tr>
                <tr>
                  <th scope="row">Known prior exposure</th>
                  <td className="small" data-testid="baseline-exposure">
                    {baseline.exposure ? (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        <li>
                          Entered via:{' '}
                          {baseline.exposure.enteredVia === 'landing_page'
                            ? 'the landing page (example AI output was shown first)'
                            : 'the research link'}
                        </li>
                        <li>Landing page seen this visit: {baseline.exposure.landingPageSeenThisVisit ? 'yes' : 'no'}</li>
                        <li>Earlier demo recorded in this browser: {yesNo(baseline.exposure.priorDemoRecordedInThisBrowser)}</li>
                        <li>Earlier landing-page view recorded in this browser: {yesNo(baseline.exposure.priorLandingViewRecordedInThisBrowser)}</li>
                        <li>Self-reported: {baseline.exposure.selfReportedPriorExposure.replace('_', ' ')}</li>
                        <li className="muted">{baseline.exposure.note}</li>
                      </ul>
                    ) : (
                      'Not recorded: this session was saved before exposure tracking existed.'
                    )}
                  </td>
                </tr>
                {state.baselineRevisions.map((r, i) => (
                  <tr key={r.timestamp + i}>
                    <th scope="row">Revised estimate {state.baselineRevisions.length > 1 ? i + 1 : ''}</th>
                    <td>
                      {r.minutesForSixSnaps} minutes ·{' '}
                      <span className="small muted">original submission kept above</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="btn-row">
              <button type="button" className="link" onClick={() => setRevising((r) => !r)} aria-expanded={revising}>
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
                        setRevised('');
                      }
                    }}
                  >
                    Save revision (the original is kept)
                  </button>
                </div>
              </div>
            )}
          </>
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
                {summary.revisedPlays > 0 && (
                  <span className="small muted"> · {summary.revisedPlays} revised at least once</span>
                )}
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
              <td data-testid="timing-baseline">
                {demo
                  ? 'No baseline collected in demo mode.'
                  : summary.baseline.minutes !== null
                    ? `${summary.baseline.minutes} minutes (self-reported)`
                    : summary.baseline.collected
                      ? 'Not sure (no estimate recorded)'
                      : 'Not captured.'}
              </td>
            </tr>
            <tr>
              <th scope="row">Accumulated review time</th>
              <td data-testid="timing-review">
                {timing.accumulatedReviewMinutes !== null ? (
                  <>
                    {timing.accumulatedReviewMinutes} minutes across {summary.playsReviewed} reviewed
                    plays
                    {timing.averageReviewSecondsPerReviewedPlay !== null &&
                      ` (average ${timing.averageReviewSecondsPerReviewedPlay} seconds per reviewed play)`}
                    {timing.reviewSecondsByPlay.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
                        {timing.reviewSecondsByPlay.map((p) => (
                          <li key={p.playNumber}>
                            Play {p.playNumber}: {p.seconds} s across {p.visits} {p.visits === 1 ? 'visit' : 'visits'}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <>
                    Not available for this session. It was saved before review intervals were
                    recorded; only each decision&rsquo;s latest-visit time survives and it is not
                    summed.
                    {timing.legacyLatestVisitSeconds && timing.legacyLatestVisitSeconds.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
                        {timing.legacyLatestVisitSeconds.map((p) => (
                          <li key={p.playNumber}>
                            Play {p.playNumber}: {p.seconds} s (latest visit only, legacy)
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </td>
            </tr>
            <tr>
              <th scope="row">Session elapsed</th>
              <td>{timing.sessionElapsedMinutes ?? '—'} minutes</td>
            </tr>
            <tr>
              <th scope="row">Exploratory comparison</th>
              <td data-testid="timing-comparison">
                {summary.comparison.comparable
                  ? `${summary.comparison.exploratoryDifferenceMinutes} minutes difference between the self-reported baseline and accumulated review time.`
                  : 'Not computed.'}{' '}
                <span className="small muted">{summary.comparison.reason}</span>
                {summary.comparison.comparable && (
                  <details className="help" style={{ marginTop: 6 }} data-testid="comparison-scope">
                    <summary>Two different tasks are being compared</summary>
                    <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {COMPARISON_SCOPE_NOTES.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <details className="help" style={{ marginTop: 8 }}>
          <summary>What each timing measure includes</summary>
          <dl className="definition-list">
            <dt>Baseline estimate</dt>
            <dd>{TIMING_DEFINITIONS.baselineMinutes}</dd>
            <dt>Accumulated review time</dt>
            <dd>{TIMING_DEFINITIONS.accumulatedReviewMinutes}</dd>
            <dt>Session elapsed</dt>
            <dd>{TIMING_DEFINITIONS.sessionElapsedMinutes}</dd>
            <dt>Exploratory comparison</dt>
            <dd>{TIMING_DEFINITIONS.exploratoryDifferenceMinutes}</dd>
          </dl>
        </details>

        <p className="small muted" style={{ marginTop: 10 }}>
          <AccuracyNote inline /> Nothing on this screen measures how often a model would be
          right, and nothing here demonstrates a productivity improvement.
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
          <summary>{demo ? 'Demo log' : 'Research Log'} ({state.events.length} events)</summary>
          <p className="small muted">
            Local data only: event names, prototype-relative timings, review intervals, play IDs,
            and your decisions (every version, in the events). Stored in this browser under{' '}
            <span className="mono">footballos.prototype.v2</span>. Pasted links are reduced to
            their host; nothing else is kept.
          </p>
          <pre className="log">{json}</pre>
        </details>
      </section>
    </>
  );
}
