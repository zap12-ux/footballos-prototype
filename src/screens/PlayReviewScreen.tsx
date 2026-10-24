import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../state/SessionContext';
import { PLAYS } from '../data/plays';
import { CHANGE_REASONS, NO_GRADE_REASONS, reasonLabel } from '../data/reasons';
import {
  ACCURACY_STATEMENT,
  CONFIDENCE_DISCLAIMER,
  CONFIDENCE_MEANING,
  GRADE_DEFINITIONS,
  gradeLabel,
  gradeShort,
  NO_GRADE_CALLOUT,
} from '../data/team';
import { ConfidenceTag, GradeBadge } from '../components/Indicators';
import { EvidencePanel, UncertaintyList } from '../components/EvidencePanel';
import { FilmStage, type FilmVideo } from '../components/FilmStage';
import { getLocalFilmUrl } from '../utils/localFilm';
import { DEMO_FILM_SRC } from '../data/demoFilm';
import type {
  ChangeReasonCode,
  CoachDecision,
  ConfidenceBand,
  GradeValue,
  NoGradeReasonCode,
} from '../types';

const GRADE_CHOICES: GradeValue[] = [3, 2, 1, 'NG'];

/** Heartbeat for the open review interval; bounds how much time a reload can lose. */
const TICK_MS = 5000;

type NoGradeIntent = 'accept' | 'coach';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

/** One-line meaning for the compact confidence row; the full text sits in the help. */
const SHORT_MEANING: Record<ConfidenceBand, string> = {
  High: 'clear in the film; still check it',
  Medium: 'partly ambiguous; look closely',
  Low: 'thin; a prompt to look, not a conclusion',
};

export function PlayReviewScreen() {
  const { state, dispatch } = useSession();
  const play = PLAYS.find((p) => p.id === state.activePlayId) ?? PLAYS[0];
  const decision = state.decisions[play.id];
  const blindGrade = state.blindGrades[play.id];
  const needsBlind = play.blindFirst && blindGrade === undefined;
  const revealed =
    !play.blindFirst || Boolean(state.revealed[play.id]) || blindGrade !== undefined;

  const [frame, setFrame] = useState(0);
  const [pendingBlind, setPendingBlind] = useState<GradeValue | null>(null);
  const [pendingChange, setPendingChange] = useState<GradeValue | null>(null);
  const [noGradeIntent, setNoGradeIntent] = useState<NoGradeIntent | null>(null);
  const [noGradeReasons, setNoGradeReasons] = useState<NoGradeReasonCode[]>([]);
  const [note, setNote] = useState<string>('');

  useEffect(() => {
    setPendingBlind(null);
    setPendingChange(null);
    setNoGradeIntent(null);
    setNoGradeReasons([]);
    setNote(state.decisions[play.id]?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play.id]);

  // Review timing. One interval is open while this screen shows this play and the tab is
  // visible. Leaving the screen, hiding the tab or hiding the page closes it; a heartbeat
  // marks the last known moment so a reload can close it without guessing.
  useEffect(() => {
    const playId = play.id;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (visible()) dispatch({ type: 'reviewOpen', playId });
    const onVisibility = () => {
      if (visible()) dispatch({ type: 'reviewOpen', playId });
      else dispatch({ type: 'reviewClose', closedBy: 'tab_hidden' });
    };
    const onPageHide = () => dispatch({ type: 'reviewClose', closedBy: 'page_hidden' });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    const tick = setInterval(() => dispatch({ type: 'reviewTick' }), TICK_MS);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      dispatch({ type: 'reviewClose', closedBy: 'navigation' });
    };
  }, [play.id, dispatch]);

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
  const playIndex = PLAYS.findIndex((p) => p.id === play.id);
  const prevPlay = playIndex > 0 ? PLAYS[playIndex - 1] : null;
  const nextPlay = playIndex < PLAYS.length - 1 ? PLAYS[playIndex + 1] : null;

  const reviewedCount = Object.keys(state.decisions).length;
  const gradedCount = Object.values(state.decisions).filter((d) => d.finalGrade !== 'NG').length;
  const noGradeCount = reviewedCount - gradedCount;
  const focusStatus =
    state.recommendationState === 'pending'
      ? 'not yet built'
      : state.recommendationState === 'stale'
        ? 'stale, needs another look'
        : state.recommendationState;

  function baseDecision(): Omit<CoachDecision, 'finalGrade' | 'action' | 'reasonCodes' | 'revision' | 'reviewSeconds'> {
    return {
      playId: play.id,
      playNumber: play.playNumber,
      candidateGrade: play.candidateGrade,
      candidateGradeConfidence: play.gradeConfidence,
      candidateIdConfidence: play.idConfidence,
      ...(blindGrade !== undefined ? { blindGrade } : {}),
      note: note.trim() ? note.trim() : undefined,
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
    <>
      <p className="progress-line review-context" data-testid="review-context" role="status">
        <strong>Play {play.playNumber} of {PLAYS.length}</strong> · {reviewedCount} reviewed ·{' '}
        {gradedCount} graded · {noGradeCount} No Grade · Practice focus: {focusStatus}
        <span className="review-nav" role="group" aria-label="Move between plays">
          <button
            type="button"
            disabled={!prevPlay}
            onClick={() => prevPlay && saveNoteAndGo('queue', prevPlay.id)}
            aria-label={prevPlay ? `Previous play: Play ${prevPlay.playNumber}` : 'Previous play'}
          >
            ‹ Prev play
          </button>
          <button
            type="button"
            disabled={!nextPlay}
            onClick={() => nextPlay && saveNoteAndGo('queue', nextPlay.id)}
            aria-label={nextPlay ? `Next play: Play ${nextPlay.playNumber}` : 'Next play'}
          >
            Next play ›
          </button>
        </span>
      </p>

      <div className="review-grid">
        <div>
          <FilmStage
            play={play}
            video={video}
            revealed={revealed}
            frame={frame}
            onFrameChange={setFrame}
          />

          {revealed && (
            <EvidencePanel play={play} frame={frame} onFrameChange={setFrame} showUncertainty={false} />
          )}

          <details className="card help">
            <summary>
              <h2 className="summary-heading">Play and player</h2>
              <span className="small muted">
                {play.playerNumber}, {play.position} · {play.quarter} {play.gameClock} · {play.situation}
              </span>
            </summary>
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
          </details>
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
                candidate, and your final decision are stored separately.
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
              <details className="help" style={{ marginTop: 10 }}>
                <summary>Why grade first?</summary>
                <p className="small muted" style={{ margin: '6px 0 0' }}>
                  Recording your own read before seeing the system&rsquo;s is a deliberate pause
                  against over-reliance. The comparison is an exploratory signal about reliance
                  on one play, not a measure of accuracy or bias.
                </p>
              </details>
            </section>
          ) : (
            <>
              {/* 2. Candidate grade and concise rationale */}
              <section className="card candidate-card" aria-labelledby="candidate-heading">
                <div className="card-head">
                  <h2 id="candidate-heading">Simulated AI candidate</h2>
                  <GradeBadge value={play.candidateGrade} large />
                </div>
                <p className="small muted candidate-sim" data-testid="candidate-sim-label">
                  <span className="tag gold">Simulated</span> authored mock result, not film analysis
                </p>

                {play.blindFirst && blindGrade !== undefined && (
                  <div className="callout gold" data-testid="blind-compare">
                    Your independent grade: <strong>{gradeShort(blindGrade)}</strong>. The
                    candidate says <strong>{gradeShort(play.candidateGrade)}</strong>. Keep yours
                    or change it &mdash; both are recorded separately.
                  </div>
                )}

                <p className="candidate-grade-line">
                  <strong>{gradeLabel(play.candidateGrade)}</strong>
                </p>
                <p className="candidate-rationale">{play.rationale}</p>

                {/* 3. Two separate confidence readings */}
                <h4>Confidence · two separate readings</h4>
                <ul className="conf-row" data-testid="confidence-row">
                  <li>
                    <ConfidenceTag kind="ID" band={play.idConfidence} compact />
                    <span className="small muted">
                      {' '}
                      is this {play.playerNumber}? {SHORT_MEANING[play.idConfidence]}
                    </span>
                  </li>
                  <li>
                    <ConfidenceTag kind="Grade" band={play.gradeConfidence} compact />
                    <span className="small muted">
                      {' '}
                      the evaluation itself: {SHORT_MEANING[play.gradeConfidence]}
                    </span>
                  </li>
                </ul>

                {/* 4. Missing evidence and uncertainty */}
                <UncertaintyList play={play} />
                {play.filmQuality.wouldEnable && (
                  <div className="callout" data-testid="would-enable">
                    <strong>What would make this gradable:</strong> {play.filmQuality.wouldEnable}
                  </div>
                )}

                <details className="help">
                  <summary>What the confidence labels mean</summary>
                  <ul className="small" style={{ paddingLeft: 18, margin: '6px 0' }}>
                    <li>
                      <strong>Player identification confidence</strong>: how sure the system is
                      that the tracked player is {play.playerNumber}.
                    </li>
                    <li>
                      <strong>Grade confidence</strong>: how sure the system is about the
                      evaluation itself. The two are never combined.
                    </li>
                    {(['High', 'Medium', 'Low'] as const).map((band) => (
                      <li key={band}>
                        <strong>{band}</strong>: {CONFIDENCE_MEANING[band]}
                      </li>
                    ))}
                  </ul>
                  <p className="small muted" style={{ margin: 0 }}>
                    {CONFIDENCE_DISCLAIMER} {ACCURACY_STATEMENT}
                  </p>
                </details>
                <details className="help">
                  <summary>What is simulated on this screen</summary>
                  <p className="small muted" style={{ margin: '6px 0 0' }}>
                    The candidate grade, rationale, evidence timestamps, uncertainty notes,
                    confidence labels and film-quality read are hand-authored data for this
                    demo play. No film was analyzed and no model was called. The footage or
                    diagram on the left is an illustration; nothing in it was detected. Your
                    decisions, reasons and timing are real and stay in this browser.
                  </p>
                </details>
              </section>

              {/* 5. Coach decision controls and saved status */}
              <section className="card" aria-labelledby="decision-heading">
                <div className="card-head">
                  <h2 id="decision-heading">Your decision</h2>
                  <span
                    className={`status-pill${decision ? ' saved' : ''}`}
                    data-testid="decision-status"
                  >
                    <span aria-hidden="true">{decision ? '✓ ' : '○ '}</span>
                    {decision ? `Saved · ${gradeShort(decision.finalGrade)}` : 'Not saved yet'}
                  </span>
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
                <p className="small muted grade-vs-ng" data-testid="grade-vs-ng">
                  <strong>Grade 1</strong> = seen, standard not met. <strong>No Grade</strong> =
                  not enough evidence to say; excluded from the practice focus.
                </p>

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
                    {pendingChange === 3 ? (
                      <p className="small muted" style={{ margin: '8px 0 0' }}>
                        Grade 3 means the standard was met. Your reason records why you overruled
                        the candidate; it is not treated as a player deficiency.
                      </p>
                    ) : (
                      <p className="small muted" style={{ margin: '8px 0 0' }}>
                        A technique reason (alignment through finish) can drive the practice
                        focus. &ldquo;AI misread the assignment&rdquo; and &ldquo;Other&rdquo;
                        describe the review and are logged without setting a focus.
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
                  <label htmlFor="coach-note">Coaching note (optional, no names)</label>
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
                        time to revise; each save replaces the previous one and every version is
                        kept in the log.
                      </span>
                    </div>
                  )}
                </div>

                <details className="help">
                  <summary>Grade 1 and No Grade, in full</summary>
                  <ul className="small" style={{ paddingLeft: 18, margin: '6px 0' }}>
                    {GRADE_DEFINITIONS.map((g) => (
                      <li key={String(g.value)}>
                        <strong>{g.label}</strong> ({g.short}): {g.definition}
                      </li>
                    ))}
                  </ul>
                  <p className="small muted" style={{ margin: 0 }}>
                    {NO_GRADE_CALLOUT}
                  </p>
                </details>

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
    </>
  );
}
