import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { PLAYS } from '../data/plays';
import { CHANGE_REASONS, NO_GRADE_REASONS, reasonLabel } from '../data/reasons';
import {
  CONFIDENCE_DISCLAIMER,
  CONFIDENCE_MEANING,
  gradeLabel,
  gradeShort,
  NO_GRADE_CALLOUT,
} from '../data/team';
import { AccuracyNote, ConfidenceTag, GradeBadge } from '../components/Indicators';
import { EvidencePanel } from '../components/EvidencePanel';
import { FilmStage, type FilmVideo } from '../components/FilmStage';
import { getLocalFilmUrl } from '../utils/localFilm';
import { DEMO_FILM_SRC } from '../data/demoFilm';
import type {
  ChangeReasonCode,
  CoachDecision,
  GradeValue,
  NoGradeReasonCode,
} from '../types';

const GRADE_CHOICES: GradeValue[] = [3, 2, 1, 'NG'];

type NoGradeIntent = 'accept' | 'coach';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function PlayReviewScreen() {
  const { state, dispatch } = useSession();
  const play = PLAYS.find((p) => p.id === state.activePlayId) ?? PLAYS[0];
  const decision = state.decisions[play.id];
  const blindGrade = state.blindGrades[play.id];
  const needsBlind = play.blindFirst && blindGrade === undefined;
  const revealed =
    !play.blindFirst || Boolean(state.revealed[play.id]) || blindGrade !== undefined;

  const openedAt = useRef<number>(Date.now());
  const [frame, setFrame] = useState(0);
  const [pendingBlind, setPendingBlind] = useState<GradeValue | null>(null);
  const [pendingChange, setPendingChange] = useState<GradeValue | null>(null);
  const [noGradeIntent, setNoGradeIntent] = useState<NoGradeIntent | null>(null);
  const [noGradeReasons, setNoGradeReasons] = useState<NoGradeReasonCode[]>([]);
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    openedAt.current = Date.now();
    setPendingBlind(null);
    setPendingChange(null);
    setNoGradeIntent(null);
    setNoGradeReasons([]);
    setNote(state.decisions[play.id]?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play.id]);

  useEffect(() => {
    setFrame(revealed ? (play.observedEvidence[0]?.frame ?? 0) : 0);
  }, [play.id, revealed, play.observedEvidence]);

  const video = useMemo<FilmVideo | null>(() => {
    if (state.filmSource === 'demo') return { url: DEMO_FILM_SRC, kind: 'demo' };
    if (state.filmSource === 'local') {
      const url = getLocalFilmUrl();
      return url ? { url, kind: 'local' } : null;
    }
    return null;
  }, [state.filmSource]);
  const nextUnreviewed = PLAYS.find((p) => p.id !== play.id && !state.decisions[p.id]);

  function elapsedSeconds() {
    return Math.max(1, Math.round((Date.now() - openedAt.current) / 1000));
  }

  function baseDecision(): Omit<CoachDecision, 'finalGrade' | 'action' | 'reasonCodes' | 'revision'> {
    return {
      playId: play.id,
      playNumber: play.playNumber,
      candidateGrade: play.candidateGrade,
      candidateGradeConfidence: play.gradeConfidence,
      candidateIdConfidence: play.idConfidence,
      ...(blindGrade !== undefined ? { blindGrade } : {}),
      note: note.trim() ? note.trim() : undefined,
      reviewSeconds: elapsedSeconds(),
      timestamp: new Date().toISOString(),
    };
  }

  function record(
    finalGrade: GradeValue,
    action: CoachDecision['action'],
    reasonCodes: CoachDecision['reasonCodes'],
  ) {
    const base = baseDecision();
    const movedTowardCandidate =
      play.blindFirst && blindGrade !== undefined
        ? blindGrade !== play.candidateGrade && finalGrade === play.candidateGrade
        : undefined;
    dispatch({
      type: 'recordDecision',
      decision: {
        ...base,
        finalGrade,
        action,
        reasonCodes,
        ...(movedTowardCandidate !== undefined ? { movedTowardCandidate } : {}),
      },
    });
  }

  function acceptCandidate() {
    setPendingChange(null);
    if (play.candidateGrade === 'NG') {
      // Accepting an abstention is still a final No Grade: it needs a structured reason.
      setNoGradeIntent('accept');
      setNoGradeReasons([]);
      return;
    }
    setNoGradeIntent(null);
    record(play.candidateGrade, 'accepted', []);
  }

  function chooseGrade(value: GradeValue) {
    if (value === play.candidateGrade) {
      acceptCandidate();
      return;
    }
    if (value === 'NG') {
      setNoGradeIntent('coach');
      setPendingChange(null);
      setNoGradeReasons([]);
      return;
    }
    setPendingChange(value);
    setNoGradeIntent(null);
  }

  function commitChange(reason: ChangeReasonCode) {
    if (pendingChange === null) return;
    record(pendingChange, 'changed', [reason]);
    setPendingChange(null);
  }

  function toggleNoGradeReason(reason: NoGradeReasonCode) {
    const next = noGradeReasons.includes(reason)
      ? noGradeReasons.filter((r) => r !== reason)
      : [...noGradeReasons, reason];
    setNoGradeReasons(next);
    if (next.length > 0) {
      record('NG', noGradeIntent === 'accept' ? 'accepted' : 'no_grade', next);
    }
  }

  function submitBlind() {
    if (pendingBlind === null) return;
    dispatch({ type: 'submitBlindGrade', playId: play.id, grade: pendingBlind });
    dispatch({ type: 'revealCandidate', playId: play.id });
  }

  function saveNote() {
    if (decision && note.trim() !== (decision.note ?? '')) {
      dispatch({ type: 'addNote', playId: play.id, note: note.trim() });
    }
  }

  function saveNoteAndGo(screen: 'queue' | 'focus', nextPlayId?: string) {
    saveNote();
    if (nextPlayId) {
      dispatch({ type: 'openPlay', playId: nextPlayId });
    } else {
      dispatch({ type: 'goto', screen });
    }
  }

  const awaitingReason =
    pendingChange !== null || (noGradeIntent !== null && noGradeReasons.length === 0);

  return (
    <div className="review-grid">
      <div>
        <FilmStage
          play={play}
          video={video}
          revealed={revealed}
          frame={frame}
          onFrameChange={setFrame}
        />

        <section className="card">
          <h2>Play and player</h2>
          <table>
            <tbody>
              <tr>
                <th scope="row">Player</th>
                <td>
                  {play.playerNumber}, {play.position}
                </td>
              </tr>
              <tr>
                <th scope="row">Concept</th>
                <td>{play.concept}</td>
              </tr>
              <tr>
                <th scope="row">Situation</th>
                <td>
                  {play.quarter} {play.gameClock} · {play.situation}
                </td>
              </tr>
              <tr>
                <th scope="row">Team context</th>
                <td>{play.teamContextVersion}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {revealed && <EvidencePanel play={play} frame={frame} onFrameChange={setFrame} />}
      </div>

      <div>
        {needsBlind ? (
          <section className="card" aria-labelledby="blind-heading">
            <div className="card-head">
              <h2 id="blind-heading">Before you see the system&rsquo;s read</h2>
              <span className="tag gold">Blind-first play</span>
            </div>
            <p>What would you grade this snap?</p>
            <p className="small muted">
              The simulated candidate, its rationale, evidence, and confidence are withheld
              until you record your own grade. Use the frames on the left. Your grade, the
              candidate, and your final decision are stored separately. This is an exploratory
              signal about reliance, not a measure of accuracy.
            </p>
            <div className="btn-row" role="group" aria-label="Your independent grade">
              {GRADE_CHOICES.map((g) => (
                <button
                  type="button"
                  key={String(g)}
                  className="chip"
                  aria-pressed={pendingBlind === g}
                  onClick={() => setPendingBlind(g)}
                >
                  {gradeShort(g)}
                </button>
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="primary"
                disabled={pendingBlind === null}
                onClick={submitBlind}
              >
                Submit my grade and reveal the candidate
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className="card" aria-labelledby="candidate-heading">
              <div className="card-head">
                <h2 id="candidate-heading">Simulated AI candidate</h2>
                <GradeBadge value={play.candidateGrade} large />
              </div>
              <p className="small muted" style={{ marginTop: -4 }}>
                Mock result. No film was analyzed to produce it. <AccuracyNote inline />
              </p>

              {play.blindFirst && blindGrade !== undefined && (
                <div className="callout gold" data-testid="blind-compare">
                  Your independent grade: <strong>{gradeShort(blindGrade)}</strong>. The
                  candidate says <strong>{gradeShort(play.candidateGrade)}</strong>. Keep yours
                  or change it &mdash; both are recorded separately.
                </div>
              )}

              <h4>Candidate grade</h4>
              <p>{gradeLabel(play.candidateGrade)}</p>

              <h4>Rationale</h4>
              <p>{play.rationale}</p>

              <h4>Confidence (two separate readings)</h4>
              <ul className="evidence-list">
                <li>
                  <span className="ts">ID</span>
                  <span>
                    <ConfidenceTag kind="ID" band={play.idConfidence} />
                    <br />
                    <span className="small muted">
                      How sure the system is that this is {play.playerNumber}.{' '}
                      {CONFIDENCE_MEANING[play.idConfidence]}
                    </span>
                  </span>
                </li>
                <li>
                  <span className="ts">Grade</span>
                  <span>
                    <ConfidenceTag kind="Grade" band={play.gradeConfidence} />
                    <br />
                    <span className="small muted">
                      How sure the system is about the evaluation itself.{' '}
                      {CONFIDENCE_MEANING[play.gradeConfidence]}
                    </span>
                  </span>
                </li>
              </ul>
              <p className="small muted">{CONFIDENCE_DISCLAIMER}</p>

              {play.filmQuality.wouldEnable && (
                <div className="callout" data-testid="would-enable">
                  <strong>What would make this gradable:</strong> {play.filmQuality.wouldEnable}
                </div>
              )}

              <div className="callout">You make the final decision. {NO_GRADE_CALLOUT}</div>
            </section>

            <section className="card" aria-labelledby="decision-heading">
              <div className="card-head">
                <h2 id="decision-heading">Your decision</h2>
                {decision && <span className="tag">Saved · you can revise it</span>}
              </div>

              <div className="btn-row" role="group" aria-label="Decision">
                <button type="button" className="accept" onClick={acceptCandidate}>
                  Accept candidate ({gradeShort(play.candidateGrade)})
                </button>
                {GRADE_CHOICES.filter((g) => g !== play.candidateGrade).map((g) => (
                  <button
                    type="button"
                    key={String(g)}
                    className="chip"
                    aria-pressed={g === 'NG' ? noGradeIntent === 'coach' : pendingChange === g}
                    onClick={() => chooseGrade(g)}
                  >
                    {g === 'NG' ? 'Mark No Grade' : `Change to ${gradeShort(g)}`}
                  </button>
                ))}
              </div>

              {pendingChange !== null && (
                <fieldset style={{ marginTop: 12 }}>
                  <legend>
                    Why {gradeShort(pendingChange)}? Pick one reason to record the change.
                  </legend>
                  <div className="btn-row">
                    {CHANGE_REASONS.map((r) => (
                      <button
                        type="button"
                        key={r.code}
                        className="chip"
                        onClick={() => commitChange(r.code)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {pendingChange === 3 && (
                    <p className="small muted" style={{ margin: '8px 0 0' }}>
                      Grade 3 means the standard was met. Your reason records why you overruled
                      the candidate; it is not treated as a player deficiency.
                    </p>
                  )}
                </fieldset>
              )}

              {noGradeIntent !== null && (
                <fieldset style={{ marginTop: 12 }}>
                  <legend>
                    {noGradeIntent === 'accept'
                      ? 'Why is this snap ungradable? Pick at least one reason to accept No Grade.'
                      : 'Why is this snap ungradable? Pick at least one reason.'}
                  </legend>
                  <div className="btn-row">
                    {NO_GRADE_REASONS.map((r) => (
                      <button
                        type="button"
                        key={r.code}
                        className="chip"
                        aria-pressed={noGradeReasons.includes(r.code)}
                        onClick={() => toggleNoGradeReason(r.code)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                  <p className="small muted" style={{ margin: '8px 0 0' }}>
                    No Grade is a coverage result, not a performance grade. It is excluded from
                    the practice focus.
                  </p>
                </fieldset>
              )}

              {awaitingReason && (
                <p className="decision-pending" role="status" data-testid="decision-pending">
                  Not saved yet &mdash; pick a reason to save this decision.
                </p>
              )}

              <div style={{ marginTop: 12 }}>
                <label htmlFor="coach-note">Coaching note (optional — no names)</label>
                <textarea
                  id="coach-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onBlur={saveNote}
                  placeholder="Anything you would say to the player about this snap."
                />
              </div>

              <div role="status" aria-live="polite">
                {decision && (
                  <div className="decision-recorded" data-testid="decision-recorded">
                    <strong>Saved:</strong> <strong>{gradeShort(decision.finalGrade)}</strong> (
                    {decision.action === 'accepted'
                      ? 'candidate accepted'
                      : decision.action === 'changed'
                        ? 'candidate changed'
                        : 'coach No Grade'}
                    )
                    {decision.reasonCodes.length > 0 && (
                      <> · Reason: {decision.reasonCodes.map(reasonLabel).join(', ')}</>
                    )}
                    <br />
                    <span className="small muted">
                      Saved at {formatTime(decision.timestamp)} · decision {decision.revision}
                      {decision.revision > 1 ? ' (revised)' : ''} · choose another grade at any
                      time to revise; each save replaces the previous one and is logged.
                    </span>
                  </div>
                )}
              </div>

              <div className="btn-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={!decision}
                  onClick={() =>
                    nextUnreviewed
                      ? saveNoteAndGo('queue', nextUnreviewed.id)
                      : saveNoteAndGo('focus')
                  }
                >
                  {nextUnreviewed
                    ? `Continue to Play ${nextUnreviewed.playNumber}`
                    : 'Continue to practice focus'}
                </button>
                <button type="button" onClick={() => saveNoteAndGo('queue')}>
                  Back to queue
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
