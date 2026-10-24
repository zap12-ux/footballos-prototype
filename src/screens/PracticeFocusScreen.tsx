import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { buildPracticeFocus } from '../utils/recommendation';
import { PLAYS } from '../data/plays';
import { gradeShort } from '../data/team';
import { reasonLabel } from '../data/reasons';
import { AccuracyNote } from '../components/Indicators';

const KIND_TAG: Record<string, string> = {
  focus: 'Practice focus',
  reinforce: 'Reinforce · no correction recorded',
  clarify: 'Needs a technique reason',
  insufficient: 'Insufficient evidence',
};

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
  // Only an actual recommendation (reinforce or focus) can be accepted, edited or dismissed.
  // "Insufficient" and "clarify" are prompts to act, not recommendations.
  const respondable = focus.kind === 'focus' || focus.kind === 'reinforce';

  function reopen(playId: string) {
    dispatch({ type: 'openPlay', playId });
  }

  return (
    <>
      <section className="card" aria-labelledby="focus-heading" data-testid={`focus-kind-${focus.kind}`}>
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

        <p className="small" style={{ marginBottom: 6 }}>
          <span className={`tag ${focus.kind === 'insufficient' || focus.kind === 'clarify' ? 'low' : 'high'}`}>
            {KIND_TAG[focus.kind]}
          </span>
        </p>

        {focus.kind === 'insufficient' && (
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
        )}

        {focus.kind === 'clarify' && (
          <div className="callout warn" data-testid="focus-clarify">
            <h2 data-testid="focus-title" style={{ color: 'inherit' }}>
              {focus.focusTitle}
            </h2>
            <p>{focus.teachingCue}</p>
            <h4 style={{ color: 'inherit' }}>Plays to clarify</h4>
            <ul className="unresolved-list" data-testid="focus-unresolved">
              {focus.unresolvedPlays.map((u) => (
                <li key={u.playNumber}>
                  <div>
                    <strong>
                      Play {u.playNumber} · {gradeShort(u.finalGrade)}
                    </strong>
                    {' · '}
                    reason recorded:{' '}
                    {u.recordedReasonLabels.length ? u.recordedReasonLabels.join(', ') : 'none'}
                    <br />
                    <span className="small">{u.why}</span>
                  </div>
                  <button type="button" onClick={() => reopen(u.playId)}>
                    Reopen Play {u.playNumber}
                  </button>
                </li>
              ))}
            </ul>
            <h4 style={{ color: 'inherit' }}>What would help</h4>
            <ul style={{ marginBottom: 0 }}>
              {focus.supportingPoints.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {respondable && (
          <>
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
              <p className="small" data-testid="focus-graded-plays">
                Graded plays: {focus.supportingPlayNumbers.map((n) => `Play ${n}`).join(', ')}. No
                correction was recorded on them.
              </p>
            )}
            {focus.driverReasonCode && (
              <p className="small" data-testid="focus-driver">
                {focus.driverSupport === 'recurring' ? (
                  <>
                    Recurring finding ({focus.supportingPlayNumbers.length} plays):{' '}
                    <strong>{reasonLabel(focus.driverReasonCode)}</strong>
                  </>
                ) : (
                  <>
                    Single finding (one play): <strong>{reasonLabel(focus.driverReasonCode)}</strong>
                  </>
                )}
              </p>
            )}

            {focus.unresolvedPlays.length > 0 && (
              <div className="callout warn" data-testid="focus-unresolved">
                <strong>Not accounted for by this focus:</strong>
                <ul className="unresolved-list" style={{ margin: '6px 0 0' }}>
                  {focus.unresolvedPlays.map((u) => (
                    <li key={u.playNumber}>
                      <div className="small">
                        <strong>
                          Play {u.playNumber} · {gradeShort(u.finalGrade)}
                        </strong>{' '}
                        · {u.why}
                      </div>
                      <button type="button" onClick={() => reopen(u.playId)}>
                        Reopen Play {u.playNumber}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
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

        {focus.limitations.length > 0 && (
          <details className="help" data-testid="focus-limitations">
            <summary>What this result does and does not cover ({focus.limitations.length})</summary>
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {focus.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="small muted">
          Composed deterministically from the decisions you recorded. Not coaching guidance from
          any outside source and not a model output.
        </p>

        {respondable && (
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

        {editing && respondable && (
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
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {PLAYS.map((play) => {
                const d = state.decisions[play.id];
                const finding = focus.findings.find((f) => f.playNumber === play.playNumber);
                const unresolved = focus.unresolvedPlays.find((u) => u.playNumber === play.playNumber);
                let used: string;
                if (!d) used = 'No — not reviewed';
                else if (d.finalGrade === 'NG') used = 'No — No Grade (insufficient evidence)';
                else if (finding) used = `Yes — ${finding.label}`;
                else if (d.finalGrade === 3) used = 'No — standard met';
                else if (unresolved) used = 'No — below standard, no technique reason recorded';
                else used = 'No — no teachable finding recorded';
                return (
                  <tr key={play.id}>
                    <th scope="row">Play {play.playNumber}</th>
                    <td>{gradeShort(play.candidateGrade)}</td>
                    <td>{d ? gradeShort(d.finalGrade) : 'Not reviewed'}</td>
                    <td>{d && d.reasonCodes.length ? d.reasonCodes.map(reasonLabel).join(', ') : '—'}</td>
                    <td>{used}</td>
                    <td>
                      <button type="button" onClick={() => reopen(play.id)} aria-label={`${d ? 'Reopen' : 'Review'} Play ${play.playNumber}`}>
                        {d ? 'Reopen' : 'Review'}
                      </button>
                    </td>
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
