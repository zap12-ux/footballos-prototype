import { useSession } from '../state/SessionContext';
import {
  ACCURACY_STATEMENT,
  CONFIDENCE_DISCLAIMER,
  CONFIDENCE_MEANING,
  GRADE_DEFINITIONS,
  NO_GRADE_CALLOUT,
  TEAM,
} from '../data/team';
import { ConfidenceTag } from '../components/Indicators';

export function TeamContextScreen() {
  const { dispatch } = useSession();

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h1>Team context</h1>
          <span className="tag">Preconfigured for this session</span>
        </div>
        <div className="two-col">
          <table>
            <tbody>
              <tr>
                <th scope="row">Program</th>
                <td>{TEAM.program} (fictional)</td>
              </tr>
              <tr>
                <th scope="row">Position group</th>
                <td>{TEAM.positionGroup}</td>
              </tr>
              <tr>
                <th scope="row">Concept</th>
                <td>{TEAM.concept}</td>
              </tr>
              <tr>
                <th scope="row">Primary player</th>
                <td>{TEAM.primaryPlayer}</td>
              </tr>
              <tr>
                <th scope="row">Rubric</th>
                <td>{TEAM.rubricVersion}</td>
              </tr>
              <tr>
                <th scope="row">Observations supported</th>
                <td>{TEAM.supportedObservations.join(' · ')}</td>
              </tr>
            </tbody>
          </table>
          <div>
            <h2>Reading confidence</h2>
            <p className="small">
              Every candidate carries two separate readings. They are never combined and
              neither one is folded into the grade.
            </p>
            <ul className="small" style={{ paddingLeft: 18 }}>
              <li>
                <strong>Player identification confidence</strong> — how sure the system is that
                the tracked player is {TEAM.primaryPlayer.split(',')[0]}.
              </li>
              <li>
                <strong>Grade confidence</strong> — how sure the system is about the evaluation
                itself.
              </li>
            </ul>
            <ul className="evidence-list">
              {(['High', 'Medium', 'Low'] as const).map((band) => (
                <li key={band}>
                  <ConfidenceTag kind="Grade" band={band} compact />
                  <span className="small">{CONFIDENCE_MEANING[band]}</span>
                </li>
              ))}
            </ul>
            <div className="callout gold small">
              {CONFIDENCE_DISCLAIMER} <strong>{ACCURACY_STATEMENT}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Grade definitions</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Grade</th>
                <th scope="col">Label</th>
                <th scope="col">Definition</th>
              </tr>
            </thead>
            <tbody>
              {GRADE_DEFINITIONS.map((g) => (
                <tr key={String(g.value)}>
                  <th scope="row">{g.label}</th>
                  <td>
                    <strong>{g.short}</strong>
                  </td>
                  <td>{g.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginTop: 16 }}>Grade 1 and No Grade are different things</h3>
        <div className="compare-grid">
          <div className="card tight">
            <h4>Grade 1 — Standard not met</h4>
            <p className="small">
              We could <strong>see</strong> the snap and the evidence shows the assignment or
              technique standard was not met. It is a performance grade and it counts in the
              practice focus.
            </p>
          </div>
          <div className="card tight">
            <h4>No Grade — Insufficient evidence</h4>
            <p className="small">
              We could <strong>not see enough</strong> to say either way: the player is off
              camera, identity is unresolved, the assignment is unknown, or context is missing.
              It is a coverage result, not a performance grade, and it is excluded from the
              practice focus.
            </p>
          </div>
        </div>
        <div className="callout">{NO_GRADE_CALLOUT}</div>
      </section>

      <div className="btn-row">
        <button
          type="button"
          className="primary"
          onClick={() => dispatch({ type: 'goto', screen: 'film' })}
        >
          Continue to film
        </button>
      </div>
    </>
  );
}
