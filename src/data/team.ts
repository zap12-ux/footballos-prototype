import type { ConfidenceBand, GradeValue } from '../types';

export const TEAM = {
  program: 'Winchester Hawks',
  positionGroup: 'Offensive Line',
  concept: 'Inside Zone Right',
  rubricVersion: 'Winchester OL Rubric v1',
  primaryPlayer: 'No. 62, Left Guard',
  opponent: 'Rockbridge (Week 4)',
  supportedObservations: [
    'Pre-snap alignment',
    'First-step direction',
    'Hand placement and leverage at contact',
    'Block engagement result',
  ],
} as const;

export interface GradeDefinition {
  value: GradeValue;
  label: string;
  short: string;
  definition: string;
}

/** Grade definitions used throughout the prototype (Module 7 specification). */
export const GRADE_DEFINITIONS: GradeDefinition[] = [
  {
    value: 3,
    label: 'Grade 3',
    short: 'Standard met',
    definition: 'The assignment and the relevant technique standard were met.',
  },
  {
    value: 2,
    label: 'Grade 2',
    short: 'Partially met',
    definition:
      'The core intent was partly achieved, but an execution issue reduced effectiveness.',
  },
  {
    value: 1,
    label: 'Grade 1',
    short: 'Standard not met',
    definition:
      'Observable evidence supports a material assignment or technique failure.',
  },
  {
    value: 'NG',
    label: 'No Grade',
    short: 'Insufficient evidence',
    definition:
      'Visibility, player identification, assignment knowledge, or play context is inadequate to evaluate the snap. This is not a performance grade.',
  },
];

export const NO_GRADE_CALLOUT =
  'No Grade is not a low grade. Grade 1 means the evidence shows the standard was not met. No Grade means there is not enough evidence to say either way. Missing evidence never becomes a low performance grade.';

export const CONFIDENCE_MEANING: Record<ConfidenceBand, string> = {
  High: 'The evidence for this read is clear in the film. Still check it — high confidence does not mean correct.',
  Medium: 'Some of the evidence is partial or ambiguous. Look closely before deciding.',
  Low: 'The evidence is thin. Treat the read as a prompt to look, not a conclusion.',
};

export const CONFIDENCE_DISCLAIMER =
  'Confidence labels in this prototype are authored, illustrative values. They are not calibrated probabilities and they say nothing about how often a real model would be right.';

export const ACCURACY_STATEMENT = 'Model accuracy: not evaluated in this prototype.';

/** Shown in the header and on the results screen whenever the session is a demo. */
export const DEMO_NOTE = 'Demo session — not research data.';

export function gradeLabel(value: GradeValue): string {
  const def = GRADE_DEFINITIONS.find((d) => d.value === value);
  return def ? `${def.label} — ${def.short}` : String(value);
}

export function gradeShort(value: GradeValue): string {
  return value === 'NG' ? 'No Grade' : `Grade ${value}`;
}
