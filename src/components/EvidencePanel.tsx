import type { Play } from '../types';

export function EvidencePanel({
  play,
  frame,
  onFrameChange,
  headingLevel = 2,
}: {
  play: Play;
  frame: number;
  onFrameChange: (index: number) => void;
  /** Heading level so the panel keeps heading order wherever it is embedded (default h2). */
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section className="card" aria-labelledby="evidence-heading">
      <div className="card-head">
        <Heading id="evidence-heading">Evidence</Heading>
        <span className="tag">Simulated — authored, not detected</span>
      </div>

      <h4>Observed evidence (select to view the frame)</h4>
      <ul className="evidence-list" data-testid="observed-evidence">
        {play.observedEvidence.map((item) => {
          const selected = item.frame === frame;
          return (
            <li key={item.timestamp + item.label}>
              <button
                type="button"
                className={`evidence-btn${selected ? ' selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onFrameChange(item.frame)}
              >
                <span className="ts">{item.timestamp}</span>
                <span>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <h4 className="uncertain-heading">Missing or uncertain evidence</h4>
      <ul className="evidence-list uncertain">
        {play.uncertainty.map((u) => (
          <li key={u}>
            <span className="ts" aria-hidden="true">?</span>
            <span className="sr-only">Uncertain: </span>
            <span>{u}</span>
          </li>
        ))}
      </ul>

      <h4 style={{ marginTop: 14 }}>Team context used</h4>
      <p className="small muted" style={{ margin: 0 }}>
        {play.teamContextVersion} · {play.concept} · {play.position} responsibilities
      </p>
    </section>
  );
}
