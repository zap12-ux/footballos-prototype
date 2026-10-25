import type { ConfidenceBand, GradeValue } from '../types';
import { ACCURACY_STATEMENT, CONFIDENCE_MEANING, gradeShort } from '../data/team';

/** Three-dot glyph so a band is never communicated by colour alone. */
const DOTS: Record<ConfidenceBand, string> = { High: '●●●', Medium: '●●○', Low: '●○○' };

export function ConfidenceTag({
  kind,
  band,
  compact = false,
}: {
  kind: 'ID' | 'Grade';
  band: ConfidenceBand;
  compact?: boolean;
}) {
  const label = kind === 'ID' ? 'Player identification confidence' : 'Grade confidence';
  return (
    <span
      className={`tag conf ${band.toLowerCase()}`}
      title={`${label}: ${band}. ${CONFIDENCE_MEANING[band]}`}
    >
      <span className="conf-dots" aria-hidden="true">
        {DOTS[band]}
      </span>
      {compact ? `${kind}: ${band}` : `${label}: ${band}`}
    </span>
  );
}

export function GradeBadge({ value, large = false }: { value: GradeValue; large?: boolean }) {
  const cls = value === 'NG' ? 'ng' : `g${value}`;
  return (
    <span className={`grade-badge ${cls}${large ? ' large' : ''}`}>{gradeShort(value)}</span>
  );
}

export function HiddenCandidateBadge() {
  return (
    <span className="grade-badge hidden-candidate">Not yet reviewed — your grade first</span>
  );
}

export function AccuracyNote({ inline = false }: { inline?: boolean }) {
  return (
    <span className={`accuracy-note${inline ? ' inline' : ''}`}>{ACCURACY_STATEMENT}</span>
  );
}

export function StatusPill({ reviewed, text }: { reviewed: boolean; text: string }) {
  return (
    <span className={`status${reviewed ? ' reviewed' : ''}`}>
      <span aria-hidden="true">{reviewed ? '✓ ' : '○ '}</span>
      {text}
    </span>
  );
}
