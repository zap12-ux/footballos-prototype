import { useMemo } from 'react';
import { useSession } from '../state/SessionContext';
import { PLAYS } from '../data/plays';
import { buildFilmCheck } from '../utils/filmCheck';
import {
  AccuracyNote,
  ConfidenceTag,
  GradeBadge,
  HiddenCandidateBadge,
  StatusPill,
} from '../components/Indicators';
import { gradeShort } from '../data/team';

export function ReviewQueueScreen() {
  const { state, dispatch } = useSession();
  const decisions = state.decisions;

  const reviewed = PLAYS.filter((p) => decisions[p.id]);
  const graded = reviewed.filter((p) => decisions[p.id].finalGrade !== 'NG');
  const noGrade = reviewed.filter((p) => decisions[p.id].finalGrade === 'NG');
  const allReviewed = reviewed.length === PLAYS.length;

  const nextUnreviewed = PLAYS.find((p) => !decisions[p.id]);
  const filmCheck = useMemo(() => buildFilmCheck(), []);

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h1>Review queue</h1>
          <span className="tag gold">Simulated AI candidates</span>
        </div>
        <div className="callout" data-testid="film-check-banner">
          <strong>Film check:</strong> {filmCheck.statement} Expect coverage below the play
          count &mdash; that is the film, not the player.
        </div>

        <div className="kpi-row" aria-label="Coverage so far">
          <div className="kpi">
            <div className="kpi-value">
              {reviewed.length} <span className="small muted">of {PLAYS.length}</span>
            </div>
            <div className="kpi-label">Reviewed by you</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{graded.length}</div>
            <div className="kpi-label">Coach-graded (Grade 1–3)</div>
          </div>
          <div className="kpi">
            <div className="kpi-value">{noGrade.length}</div>
            <div className="kpi-label">No Grade (insufficient evidence)</div>
          </div>
        </div>
        <p className="progress-line" data-testid="coverage-progress">
          {reviewed.length} of {PLAYS.length} reviewed · {graded.length} graded ·{' '}
          {noGrade.length} No Grade
        </p>

        <div className="table-scroll">
          <table className="queue-table">
            <thead>
              <tr>
                <th scope="col">Play</th>
                <th scope="col">Player</th>
                <th scope="col">Candidate</th>
                <th scope="col">ID confidence</th>
                <th scope="col">Grade confidence</th>
                <th scope="col">Film</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {PLAYS.map((play) => {
                const decision = decisions[play.id];
                const hideCandidate = play.blindFirst && !decision;
                const tier = play.filmQuality.tier;
                const tierClass = tier === 'Good' ? 'high' : tier === 'Fair' ? 'medium' : 'low';
                return (
                  <tr key={play.id} className={decision ? 'row-reviewed' : undefined}>
                    <th scope="row">
                      Play {play.playNumber}
                      <br />
                      <span className="small muted">
                        {play.quarter} {play.gameClock} · {play.situation}
                      </span>
                    </th>
                    <td>
                      {play.playerNumber}
                      <br />
                      <span className="small muted">{play.position}</span>
                    </td>
                    <td>
                      {hideCandidate ? (
                        <HiddenCandidateBadge />
                      ) : (
                        <GradeBadge value={play.candidateGrade} />
                      )}
                    </td>
                    <td>
                      {hideCandidate ? (
                        <span className="small muted">Withheld</span>
                      ) : (
                        <ConfidenceTag kind="ID" band={play.idConfidence} compact />
                      )}
                    </td>
                    <td>
                      {hideCandidate ? (
                        <span className="small muted">Withheld</span>
                      ) : (
                        <ConfidenceTag kind="Grade" band={play.gradeConfidence} compact />
                      )}
                    </td>
                    <td>
                      <span className={`tag ${tierClass}`}>{tier}</span>
                    </td>
                    <td>
                      {decision ? (
                        <StatusPill
                          reviewed
                          text={`Reviewed — ${gradeShort(decision.finalGrade)}`}
                        />
                      ) : (
                        <StatusPill reviewed={false} text="Not reviewed" />
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={decision ? '' : 'primary'}
                        onClick={() => dispatch({ type: 'openPlay', playId: play.id })}
                        aria-label={`${decision ? 'Reopen' : 'Review'} Play ${play.playNumber}`}
                      >
                        {decision ? 'Reopen' : 'Review Play'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>
          ID confidence and grade confidence are separate readings and are never combined. They
          are authored, illustrative labels. <AccuracyNote inline />
        </p>
      </section>

      <div className="btn-row">
        {nextUnreviewed && (
          <button
            type="button"
            className="primary"
            onClick={() => dispatch({ type: 'openPlay', playId: nextUnreviewed.id })}
          >
            Review Play {nextUnreviewed.playNumber}
          </button>
        )}
        <button
          type="button"
          className={allReviewed ? 'accept' : ''}
          disabled={!allReviewed}
          onClick={() => dispatch({ type: 'goto', screen: 'focus' })}
        >
          Continue to practice focus
        </button>
        {!allReviewed && (
          <span className="small muted">
            Available once every play in the queue has a coach decision.
          </span>
        )}
      </div>
    </>
  );
}
