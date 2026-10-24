import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { buildPracticeFocus } from '../utils/recommendation';
import { PLAYS } from '../data/plays';
import { gradeShort } from '../data/team';
import { reasonLabel } from '../data/reasons';
import { AccuracyNote } from '../components/Indicators';

export function PracticeFocusScreen() {
  const { state, dispatch } = useSession();
  const focus = useMemo(() => buildPracticeFocus(state.decisions), [state.decisions]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.recommendationEdit ?? focus.focusTitle);

  useEffect(() => {
    if (!editing) setDraft(state.recommendationEdit ?? focus.focusTitle);
  }, [focus.focusTitle, state.recommendationEdit, editing]);

  const stale = state.recommendationState === 'stale';
  const showEdited = state.recommendationState === 'edited' && state.recommendationEdit;
  const title = showEdited ? state.recommendationEdit : focus.focusTitle;
  const insufficient = focus.kind === 'insufficient';

  return (
    <>
      <section className="card" aria-labelledby="focus-heading">
        <div className="card-head">
          <h1 id="focus-heading">Practice focus</h1>
          <span className="tag gold">Simulated · built from your decisions only</span>
        </div>

        {stale && (
          <div className="decision-recorded stale" role="alert" data-testid="focus-stale">
            <strong>Needs another look.</strong> A play decision changed after you reviewed
            this practice focus, so your earlier response was set aside. The focus below was
            rebuilt from your current decisions. Accept, edit, or dismiss it again.
          </div>
        )}

        {insufficient ? (
          <div className="callout warn" data-testid="focus-insufficient">
            <h2 data-testid="focus-title" style={{ color: 'inherit' }}>
              {focus.focusTitle}
            </h2>
            <p>{focus.teachingCue}</p>
            <h4 style={{ color: 'inherit' }}>What would help</h4>
            <ul style={{ marginBottom: 0 }}>
              {focus.supportingPoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {focus.kind === 'maintain' && (
              <p className="small muted">No change recommended.</p>
            )}
            <h2 data-testid="focus-title">{title}</h2>
            {showEdited && (
              <p className="small muted">
                Edited by you. Original: &ldquo;{focus.focusTitle}&rdquo;
              </p>
            )}
            <p>
              <strong>Teaching cue:</strong> {focus.teachingCue}
            </p>

            {focus.supportingPoints.length > 0 && (
              <>
                <h4>Supporting teaching points (up to two)</h4>
                <ul>
                  {focus.supportingPoints.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            )}

            <h4>Plays and findings behind this</h4>
            {focus.findings.length > 0 ? (
              <ul className="small" data-testid="focus-findings">
                {focus.findings.map((f) => (
                  <li key={`${f.playNumber}-${f.reasonCode}-${f.source}`}>
                    Play {f.playNumber}: {f.label}{' '}
                    <span className="muted">
                      ({f.source === 'coach_changed' ? 'your correction' : 'candidate you accepted'})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small">
                No coach-graded play contributed a correctable finding.
                {focus.supportingPlayNumbers.length > 0 &&
                  ` Graded plays: ${focus.supportingPlayNumbers.map((n) => `Play ${n}`).join(', ')}.`}
              </p>
            )}
            {focus.driverReasonCode && (
              <p className="small">
                Most frequent recorded finding:{' '}
                <strong>{reasonLabel(focus.driverReasonCode)}</strong>
              </p>
            )}
          </>
        )}

        {focus.nonTeachingNotes.length > 0 && (
          <div className="callout" data-testid="focus-non-teaching">
            <strong>Logged, not treated as a deficiency:</strong>
            <ul style={{ margin: '6px 0 0' }}>
              {focus.nonTeachingNotes.map((n) => (
                <li key={n} className="small">
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="callout" data-testid="coverage-statement">
          <strong>Coverage:</strong> {focus.coverageStatement}
          <br />
          <span className="small">
            Coverage describes how many plays could be assessed. It says nothing about whether
            the assessments are correct. <AccuracyNote inline />
          </span>
        </div>

        <p className="small muted">
          This practice focus is composed deterministically from the decisions you recorded. It
          is not coaching guidance from any outside source and it is not a model output.
        </p>

        {!insufficient && (
          <div className="btn-row" role="group" aria-label="Practice focus response">
            <button
              type="button"
              className="accept"
              onClick={() => dispatch({ type: 'setRecommendation', state: 'accepted' })}
            >
              Accept
            </button>
            <button type="button" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
              Edit
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: 'setRecommendation', state: 'dismissed' })}
            >
              Dismiss
            </button>
            <span className="small muted" data-testid="focus-state" role="status">
              {state.recommendationState === 'pending'
                ? 'Not yet reviewed'
                : stale
                  ? 'Stale — review again'
                  : `Recorded: ${state.recommendationState}`}
            </span>
          </div>
        )}

        {editing && !insufficient && (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="focus-edit">Revised practice focus (no names)</label>
            <textarea
              id="focus-edit"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  dispatch({ type: 'setRecommendation', state: 'edited', edit: draft.trim() || focus.focusTitle });
                  setEditing(false);
                }}
              >
                Save edit
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>What went into this</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Play</th>
                <th scope="col">Candidate</th>
                <th scope="col">Your decision</th>
                <th scope="col">Reason recorded</th>
                <th scope="col">Used in the focus</th>
              </tr>
            </thead>
            <tbody>
              {PLAYS.map((play) => {
                const d = state.decisions[play.id];
                const finding = focus.findings.find((f) => f.playNumber === play.playNumber);
                let used: string;
                if (!d) used = 'No — not reviewed';
                else if (d.finalGrade === 'NG') used = 'No — No Grade (insufficient evidence)';
                else if (finding) used = `Yes — ${finding.label}`;
                else if (d.finalGrade === 3) used = 'No — standard met';
                else used = 'No — no teachable finding recorded';
                return (
                  <tr key={play.id}>
                    <th scope="row">Play {play.playNumber}</th>
                    <td>{gradeShort(play.candidateGrade)}</td>
                    <td>{d ? gradeShort(d.finalGrade) : 'Not reviewed'}</td>
                    <td>{d && d.reasonCodes.length ? d.reasonCodes.map(reasonLabel).join(', ') : '—'}</td>
                    <td>{used}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="btn-row">
        <button
          type="button"
          className="primary"
          onClick={() => dispatch({ type: 'goto', screen: 'summary' })}
        >
          Continue to research questions
        </button>
        <button type="button" onClick={() => dispatch({ type: 'goto', screen: 'queue' })}>
          Back to queue
        </button>
      </div>
    </>
  );
}
