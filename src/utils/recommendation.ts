import { PLAYS } from '../data/plays';
import { REASON_COACHING, TEACHABLE_CODES, reasonLabel } from '../data/reasons';
import { gradeShort } from '../data/team';
import type {
  ChangeReasonCode,
  CoachDecision,
  FocusFinding,
  PracticeFocus,
} from '../types';

const CHANGE_CODES: ChangeReasonCode[] = [
  'alignment_stance',
  'first_step',
  'target_track',
  'hand_placement',
  'pad_level',
  'combo_climb',
  'finish',
  'ai_misread',
  'other',
];

function isChangeCode(code: string): code is ChangeReasonCode {
  return (CHANGE_CODES as string[]).includes(code);
}

function isTeachable(code: ChangeReasonCode): boolean {
  return TEACHABLE_CODES.includes(code);
}

function playList(numbers: number[]): string {
  return numbers.map((n) => `Play ${n}`).join(', ');
}

/**
 * Deterministic practice focus built ONLY from coach-approved results.
 *
 * Rules:
 * - No Grade decisions and unreviewed plays are excluded from the logic and the
 *   exclusion is stated.
 * - A finding only exists on a play whose FINAL grade is 1 or 2. A correction to
 *   Grade 3 is "standard met": the reason the coach gave explains the overrule
 *   and is never converted into a player deficiency.
 * - "AI misread the assignment" and "Other" describe the review, not the
 *   player. They are logged but never drive a teaching point.
 * - If no reviewed play has a coach grade, the result is an insufficient-evidence
 *   state, not a recommendation to maintain or change anything.
 */
export function buildPracticeFocus(
  decisions: Record<string, CoachDecision>,
): PracticeFocus {
  const reviewed = PLAYS.filter((p) => decisions[p.id]);
  const unreviewed = PLAYS.filter((p) => !decisions[p.id]);
  const graded = reviewed.filter((p) => decisions[p.id].finalGrade !== 'NG');
  const excluded = reviewed.filter((p) => decisions[p.id].finalGrade === 'NG');

  const findings: FocusFinding[] = [];
  const nonTeachingNotes: string[] = [];

  for (const play of graded) {
    const decision = decisions[play.id];
    const final = decision.finalGrade;

    if (decision.action === 'changed') {
      const codes = decision.reasonCodes.filter(isChangeCode);
      if (final === 3) {
        nonTeachingNotes.push(
          `Play ${play.playNumber} was corrected to Grade 3 (standard met). The recorded reason, ` +
            `“${codes.map(reasonLabel).join(', ') || 'none'}”, explains the overrule and is not treated as a player deficiency.`,
        );
        continue;
      }
      for (const code of codes) {
        if (isTeachable(code)) {
          findings.push({
            playNumber: play.playNumber,
            reasonCode: code,
            label: reasonLabel(code),
            source: 'coach_changed',
          });
        } else {
          nonTeachingNotes.push(
            `Play ${play.playNumber} was changed to ${gradeShort(final)} with the reason “${reasonLabel(code)}”. ` +
              'That reason describes the review, not the player, so it does not drive the focus. ' +
              'Add a technique reason if you want this play to count.',
          );
        }
      }
    } else if (decision.action === 'accepted') {
      // Accepting a 1 or 2 makes the candidate's stated issue a coach-approved finding.
      if ((final === 1 || final === 2) && play.impliedReasonCode) {
        findings.push({
          playNumber: play.playNumber,
          reasonCode: play.impliedReasonCode,
          label: reasonLabel(play.impliedReasonCode),
          source: 'accepted_candidate',
        });
      }
    }
  }

  const counts = new Map<ChangeReasonCode, number>();
  const playsByCode = new Map<ChangeReasonCode, number[]>();
  for (const f of findings) {
    counts.set(f.reasonCode, (counts.get(f.reasonCode) ?? 0) + 1);
    const list = playsByCode.get(f.reasonCode) ?? [];
    if (!list.includes(f.playNumber)) list.push(f.playNumber);
    playsByCode.set(f.reasonCode, list);
  }

  // Most frequent code wins; ties break toward the earliest supporting play.
  let driver: ChangeReasonCode | null = null;
  let best = 0;
  let bestFirstPlay = Number.MAX_SAFE_INTEGER;
  for (const [code, count] of counts) {
    const firstPlay = Math.min(...(playsByCode.get(code) ?? [Number.MAX_SAFE_INTEGER]));
    if (count > best || (count === best && firstPlay < bestFirstPlay)) {
      driver = code;
      best = count;
      bestFirstPlay = firstPlay;
    }
  }

  const excludedNumbers = excluded.map((p) => p.playNumber);
  const unreviewedNumbers = unreviewed.map((p) => p.playNumber);
  const coverageStatement =
    `Based on ${graded.length} coach-graded ${graded.length === 1 ? 'play' : 'plays'} ` +
    `of ${reviewed.length} reviewed.` +
    (excludedNumbers.length
      ? ` ${playList(excludedNumbers)} ${excludedNumbers.length === 1 ? 'was' : 'were'} No Grade and ` +
        `${excludedNumbers.length === 1 ? 'is' : 'are'} not included.`
      : ' No reviewed plays were excluded.') +
    (unreviewedNumbers.length
      ? ` ${playList(unreviewedNumbers)} ${unreviewedNumbers.length === 1 ? 'has' : 'have'} not been reviewed and ` +
        `${unreviewedNumbers.length === 1 ? 'is' : 'are'} not included.`
      : '');

  const common = {
    findings,
    nonTeachingNotes,
    coverageStatement,
    gradedCount: graded.length,
    reviewedCount: reviewed.length,
    excludedPlayNumbers: excludedNumbers,
    unreviewedPlayNumbers: unreviewedNumbers,
  };

  if (graded.length === 0) {
    return {
      kind: 'insufficient',
      focusTitle: 'Insufficient evidence for a practice focus',
      teachingCue:
        'No reviewed play has a coach grade, so there is no basis to recommend keeping or changing anything. This is a coverage result, not a performance result.',
      supportingPoints: [
        'Get a gradable angle for the excluded snaps — an end-zone copy or a fixed sideline angle.',
        'Review the remaining plays in the queue, or grade from another film source.',
      ],
      supportingPlayNumbers: [],
      driverReasonCode: null,
      ...common,
    };
  }

  if (!driver) {
    return {
      kind: 'maintain',
      focusTitle: 'No recurring correction surfaced',
      teachingCue:
        'Coach-approved grades on these snaps did not record a recurring, teachable issue. Reinforce the standard already being met.',
      supportingPoints: [
        'Use the graded snaps as teaching examples of the standard.',
        'Re-check the emphasis after the next film review.',
      ],
      supportingPlayNumbers: graded.map((p) => p.playNumber),
      driverReasonCode: null,
      ...common,
    };
  }

  const coaching = REASON_COACHING[driver];
  return {
    kind: 'focus',
    focusTitle: coaching.focusTitle,
    teachingCue: coaching.teachingCue,
    supportingPoints: coaching.supportingPoints.slice(0, 2),
    supportingPlayNumbers: (playsByCode.get(driver) ?? []).sort((a, b) => a - b),
    driverReasonCode: driver,
    ...common,
  };
}
