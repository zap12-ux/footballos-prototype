import { PLAYS } from '../data/plays';
import { REASON_COACHING, TEACHABLE_CODES, reasonLabel } from '../data/reasons';
import { gradeShort } from '../data/team';
import type {
  ChangeReasonCode,
  CoachDecision,
  FocusFinding,
  PracticeFocus,
  UnresolvedPlay,
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

/** Fixed wording so the UI, the export and the tests agree on what each state is called. */
export const FOCUS_TITLES = {
  insufficient: 'Insufficient evidence for a practice focus',
  reinforce: 'Reinforce the standard on the graded snaps',
  clarify: 'Clarify the coaching issue before setting a focus',
} as const;

/**
 * Deterministic practice focus built ONLY from coach-approved results.
 *
 * Four distinct outcomes, decided in this order:
 *
 *  A. insufficient — no reviewed play has a coach grade. Nothing about performance is
 *     inferred; the next step is better film.
 *  B. reinforce    — every coach-graded play is Grade 3. Limited to those plays.
 *  C. clarify      — at least one final grade is 1 or 2, but no usable technique finding
 *     exists (the reason was "AI misread the assignment", "Other", or none). The grade says
 *     there is a problem; the recorded reason does not say what to coach. Never presented
 *     as the standard being met.
 *  D. focus        — coach-approved technique findings exist. Below-standard plays without
 *     a technique reason are listed as a limitation, and a finding supported by one play is
 *     never called recurring.
 *
 * Throughout:
 * - No Grade decisions and unreviewed plays are excluded and the exclusion is stated.
 * - A correction to Grade 3 is "standard met": the recorded reason explains the overrule
 *   and is never converted into a player deficiency.
 * - "AI misread the assignment" and "Other" describe the review, not the player. They are
 *   logged but never drive a teaching point.
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
  const unresolvedPlays: UnresolvedPlay[] = [];

  for (const play of graded) {
    const decision = decisions[play.id];
    const final = decision.finalGrade;
    const codes = decision.reasonCodes.filter(isChangeCode);
    const before = findings.length;

    if (decision.action === 'changed') {
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
              'That reason describes the review, not the player, so it does not drive the focus.',
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

    // A below-standard grade with nothing teachable behind it is a gap, not a pass.
    if ((final === 1 || final === 2) && findings.length === before) {
      const labels = codes.map(reasonLabel);
      unresolvedPlays.push({
        playNumber: play.playNumber,
        playId: play.id,
        finalGrade: final,
        recordedReasonLabels: labels,
        why:
          labels.length > 0
            ? `${gradeShort(final)} indicates a problem, but “${labels.join(', ')}” describes the review, not what to coach.`
            : `${gradeShort(final)} indicates a problem, but no technique reason was recorded.`,
      });
    }
  }

  const counts = new Map<ChangeReasonCode, number>();
  const playsByCode = new Map<ChangeReasonCode, number[]>();
  for (const f of findings) {
    const list = playsByCode.get(f.reasonCode) ?? [];
    if (!list.includes(f.playNumber)) list.push(f.playNumber);
    playsByCode.set(f.reasonCode, list);
    counts.set(f.reasonCode, list.length);
  }

  // Most plays wins; ties break toward the earliest supporting play.
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

  const limitations: string[] = [];
  if (excludedNumbers.length) {
    limitations.push(
      `${playList(excludedNumbers)} ${excludedNumbers.length === 1 ? 'is' : 'are'} No Grade: insufficient evidence, not a performance result.`,
    );
  }
  if (unreviewedNumbers.length) {
    limitations.push(`${playList(unreviewedNumbers)} ${unreviewedNumbers.length === 1 ? 'has' : 'have'} no decision yet.`);
  }

  const common = {
    findings,
    nonTeachingNotes,
    coverageStatement,
    gradedCount: graded.length,
    reviewedCount: reviewed.length,
    excludedPlayNumbers: excludedNumbers,
    unreviewedPlayNumbers: unreviewedNumbers,
    unresolvedPlays,
  };

  // A. No graded evidence.
  if (graded.length === 0) {
    return {
      kind: 'insufficient',
      focusTitle: FOCUS_TITLES.insufficient,
      teachingCue:
        'No reviewed play has a coach grade, so there is no basis to recommend keeping or changing anything. This is a coverage result, not a performance result.',
      supportingPoints: [
        'Get a gradable angle for the excluded snaps: an end-zone copy or a fixed sideline angle.',
        'Review the remaining plays in the queue, or grade from another film source.',
      ],
      supportingPlayNumbers: [],
      driverReasonCode: null,
      driverSupport: 'none',
      limitations: [
        'Nothing here says the player met or missed the standard. No Grade means the film could not be assessed.',
        ...limitations,
      ],
      ...common,
    };
  }

  const belowStandard = graded.filter((p) => decisions[p.id].finalGrade !== 3);

  // B. Every graded play meets the standard.
  if (belowStandard.length === 0) {
    const gradedNumbers = graded.map((p) => p.playNumber);
    return {
      kind: 'reinforce',
      focusTitle: FOCUS_TITLES.reinforce,
      teachingCue: `Every coach-graded snap (${playList(gradedNumbers)}) was Grade 3. Reinforce what these snaps show; no correction was recorded on them.`,
      supportingPoints: [
        'Use these graded snaps as teaching examples of the standard.',
        'Re-check the emphasis after the next film review.',
      ],
      supportingPlayNumbers: gradedNumbers,
      driverReasonCode: null,
      driverSupport: 'none',
      limitations: [
        `This conclusion covers only the ${graded.length} coach-graded ${graded.length === 1 ? 'play' : 'plays'}.`,
        ...limitations,
      ],
      ...common,
    };
  }

  // C. Below-standard grades, but nothing actionable to coach.
  if (!driver) {
    const list = unresolvedPlays
      .map((u) => `Play ${u.playNumber} (${gradeShort(u.finalGrade)})`)
      .join(', ');
    return {
      kind: 'clarify',
      focusTitle: FOCUS_TITLES.clarify,
      teachingCue:
        `${list} ${unresolvedPlays.length === 1 ? 'is' : 'are'} below the standard, but the recorded ` +
        `${unresolvedPlays.length === 1 ? 'reason does' : 'reasons do'} not identify what to coach. ` +
        'The grade says there is a problem; a technique reason is needed to turn it into a practice focus.',
      supportingPoints: [
        'Reopen each play below and add a technique reason (for example hand placement or first step) if the film supports one.',
        'If the grade itself was a misread, revise the grade rather than the focus.',
      ],
      supportingPlayNumbers: [],
      driverReasonCode: null,
      driverSupport: 'none',
      limitations: [
        'No practice focus is recommended and no "standard met" conclusion is drawn from these plays.',
        ...limitations,
      ],
      ...common,
    };
  }

  // D. Actionable technique findings exist.
  const supporting = (playsByCode.get(driver) ?? []).slice().sort((a, b) => a - b);
  const driverSupport = supporting.length > 1 ? 'recurring' : 'single';
  const coaching = REASON_COACHING[driver];
  if (unresolvedPlays.length) {
    limitations.unshift(
      `${playList(unresolvedPlays.map((u) => u.playNumber))} ${unresolvedPlays.length === 1 ? 'is' : 'are'} below the standard ` +
        'but carry no technique reason, so the focus does not account for them.',
    );
  }
  if (driverSupport === 'single') {
    limitations.unshift(
      `“${reasonLabel(driver)}” is supported by one play (Play ${supporting[0]}). It is a single finding, not a recurring issue.`,
    );
  }
  return {
    kind: 'focus',
    focusTitle: coaching.focusTitle,
    teachingCue: coaching.teachingCue,
    supportingPoints: coaching.supportingPoints.slice(0, 2),
    supportingPlayNumbers: supporting,
    driverReasonCode: driver,
    driverSupport,
    limitations,
    ...common,
  };
}
