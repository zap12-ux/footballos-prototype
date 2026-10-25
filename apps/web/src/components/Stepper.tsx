import type { ScreenId } from '../types';

const STEPS: { id: ScreenId; label: string }[] = [
  { id: 'intro', label: '1. Start' },
  { id: 'team', label: '2. Team context' },
  { id: 'film', label: '3. Film' },
  { id: 'queue', label: '4. Review queue' },
  { id: 'review', label: '5. Play review' },
  { id: 'focus', label: '6. Practice focus' },
  { id: 'summary', label: '7. Feedback & results' },
];

export function Stepper({ current }: { current: ScreenId }) {
  const index = STEPS.findIndex((s) => s.id === current);
  return (
    <nav className="stepper" aria-label="Workflow progress">
      <ol>
        {STEPS.map((step, i) => (
          <li
            key={step.id}
            className={`step${i === index ? ' current' : ''}${i < index ? ' done' : ''}`}
            aria-current={i === index ? 'step' : undefined}
          >
            {i < index && (
              <span className="sr-only">Completed: </span>
            )}
            {step.label}
          </li>
        ))}
      </ol>
    </nav>
  );
}
