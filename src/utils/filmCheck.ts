import { PLAYS } from '../data/plays';
import type { Play } from '../types';

export interface FilmCheck {
  totalPlays: number;
  gradeablePlays: number;
  atRiskPlays: Play[];
  /** Distinct film issues across the snaps flagged as at risk. */
  issues: string[];
  /** Deterministic summary sentence shown before the coach starts reviewing. */
  statement: string;
}

/**
 * Simulated pre-review film check.
 *
 * The point of showing this BEFORE the review queue is that coverage should be an
 * expectation the coach sets out with, not a disappointment they discover one
 * abstention at a time. Gradeability is judged per task (interior offensive line
 * here) rather than per file — the same snap can be fine for another position.
 */
export function buildFilmCheck(plays: Play[] = PLAYS): FilmCheck {
  const atRisk = plays.filter((p) => !p.filmQuality.gradeableForecast);
  const gradeable = plays.length - atRisk.length;
  const issues = [...new Set(atRisk.flatMap((p) => p.filmQuality.issues))];

  const statement =
    `${gradeable} of ${plays.length} snaps look gradable for interior offensive line.` +
    (atRisk.length
      ? ` ${atRisk.map((p) => `Play ${p.playNumber}`).join(' and ')} ` +
        `${atRisk.length === 1 ? 'is' : 'are'} likely to come back No Grade.`
      : '');

  return {
    totalPlays: plays.length,
    gradeablePlays: gradeable,
    atRiskPlays: atRisk,
    issues,
    statement,
  };
}
