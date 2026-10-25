import type { Play } from '../types';
import { TEAM } from './team';

/**
 * Seeded, deterministic mock plays. No video is analyzed and no model is called.
 * Every "candidate", every confidence label, every film-quality read and every
 * storyboard frame below is authored copy, not a computed result.
 *
 * The storyboard is an illustrative schematic that stands in for footage. It is
 * not tracking output and it is not evidence of model performance.
 */
export const PLAYS: Play[] = [
  {
    id: 'play-1',
    playNumber: 1,
    quarter: 'Q1',
    gameClock: '09:47',
    situation: '1st & 10, own 34',
    concept: TEAM.concept,
    playerNumber: 'No. 62',
    position: 'Left Guard',
    candidateGrade: 3,
    gradeConfidence: 'High',
    idConfidence: 'High',
    rationale:
      'Correct first-step direction, inside hand placement on the play-side number, and the defender is displaced off the track through the whistle.',
    observedEvidence: [
      { timestamp: '00:08.9', label: 'Pre-snap alignment matches the rubric split for Inside Zone Right.', frame: 0 },
      { timestamp: '00:11.2', label: 'First movement: play-side step toward the near foot of the 3-technique.', frame: 1 },
      { timestamp: '00:11.8', label: 'Initial contact with inside hand placed on the play-side number.', frame: 2 },
      { timestamp: '00:13.6', label: 'Defender displaced past the original track; block sustained to the whistle.', frame: 3 },
    ],
    uncertainty: ['No material uncertainty on this snap. The player is in frame from snap to whistle.'],
    teamContextVersion: TEAM.rubricVersion,
    filmQuality: { tier: 'Good', issues: [], gradeableForecast: true },
    storyboard: [
      { id: 'p1-f0', phase: 'presnap', timestamp: '00:08.9', neutralCaption: 'Pre-snap. Offense set, front aligned.', scene: { visibility: 'full', defender: 'aligned' } },
      { id: 'p1-f1', phase: 'first_step', timestamp: '00:11.2', neutralCaption: 'First movement after the snap.', scene: { visibility: 'full', guardStep: 'playside', defender: 'aligned' } },
      { id: 'p1-f2', phase: 'contact', timestamp: '00:11.8', neutralCaption: 'Initial contact.', scene: { visibility: 'full', guardStep: 'playside', hands: 'inside', defender: 'engaged' } },
      { id: 'p1-f3', phase: 'result', timestamp: '00:13.6', neutralCaption: 'Block result through the whistle.', scene: { visibility: 'full', hands: 'inside', defender: 'displaced' } },
    ],
    blindFirst: false,
    impliedReasonCode: null,
  },
  {
    id: 'play-2',
    playNumber: 2,
    quarter: 'Q1',
    gameClock: '06:12',
    situation: '2nd & 6, own 41',
    concept: TEAM.concept,
    playerNumber: 'No. 62',
    position: 'Left Guard',
    candidateGrade: 2,
    gradeConfidence: 'Medium',
    idConfidence: 'High',
    rationale:
      'Correct first-step direction and initial engagement, but hand placement appears late — hands arrive after the second step rather than on contact.',
    observedEvidence: [
      { timestamp: '00:12.4', label: 'First movement: play-side step in the correct direction.', frame: 1 },
      { timestamp: '00:13.1', label: 'Initial contact made; hands not yet fitted inside.', frame: 2 },
      { timestamp: '00:13.5', label: 'Hands fit inside after the second step lands.', frame: 3 },
    ],
    uncertainty: [
      'Defender becomes partially obstructed after initial contact.',
      'Final hand position through the whistle is not clearly visible.',
    ],
    teamContextVersion: TEAM.rubricVersion,
    filmQuality: { tier: 'Fair', issues: ['Defender partially obstructed after contact.'], gradeableForecast: true },
    storyboard: [
      { id: 'p2-f0', phase: 'presnap', timestamp: '00:11.6', neutralCaption: 'Pre-snap. Offense set, front aligned.', scene: { visibility: 'full', defender: 'aligned' } },
      { id: 'p2-f1', phase: 'first_step', timestamp: '00:12.4', neutralCaption: 'First movement after the snap.', scene: { visibility: 'full', guardStep: 'playside', defender: 'aligned' } },
      { id: 'p2-f2', phase: 'contact', timestamp: '00:13.1', neutralCaption: 'Initial contact. Defender partly obstructed.', scene: { visibility: 'partial', guardStep: 'playside', hands: 'not_fitted', defender: 'engaged' } },
      { id: 'p2-f3', phase: 'result', timestamp: '00:13.5', neutralCaption: 'Second step lands. Defender partly obstructed.', scene: { visibility: 'partial', hands: 'inside', defender: 'engaged' } },
    ],
    blindFirst: false,
    impliedReasonCode: 'hand_placement',
  },
  {
    id: 'play-3',
    playNumber: 3,
    quarter: 'Q2',
    gameClock: '11:03',
    situation: '1st & 10, opp 48',
    concept: TEAM.concept,
    playerNumber: 'No. 62',
    position: 'Left Guard',
    candidateGrade: 'NG',
    gradeConfidence: 'Low',
    idConfidence: 'Low',
    rationale:
      'The system is not confident this is No. 62, and the interior of the line leaves the frame at the snap. There is not enough evidence to evaluate the assignment. This is an abstention, not a low grade.',
    observedEvidence: [
      { timestamp: '00:04.1', label: 'Two interior linemen with similar numbers are visible pre-snap; identity is unresolved.', frame: 0 },
      { timestamp: '00:06.0', label: 'Camera pans with the ball; the interior of the line leaves the frame at the snap.', frame: 1 },
    ],
    uncertainty: [
      'Player identification is unresolved (No. 62 versus No. 66).',
      'Point of contact is off-camera.',
      'Assignment cannot be confirmed without the interior view.',
    ],
    teamContextVersion: TEAM.rubricVersion,
    filmQuality: {
      tier: 'Poor',
      issues: [
        'Camera pans with the ball; the interior leaves the frame at the snap.',
        'Two similar jersey numbers unresolved pre-snap.',
      ],
      gradeableForecast: false,
      wouldEnable:
        'A synchronized end-zone copy of this snap would resolve the identity and show the point of contact.',
    },
    storyboard: [
      { id: 'p3-f0', phase: 'presnap', timestamp: '00:04.1', neutralCaption: 'Pre-snap. Two interior linemen with similar numbers.', scene: { visibility: 'full', identityUnresolved: true, defender: 'aligned' } },
      { id: 'p3-f1', phase: 'first_step', timestamp: '00:06.0', neutralCaption: 'Camera pans with the ball at the snap.', scene: { visibility: 'interior_lost', identityUnresolved: true } },
      { id: 'p3-f2', phase: 'contact', timestamp: '00:06.7', neutralCaption: 'Interior of the line is out of frame.', scene: { visibility: 'interior_lost' } },
      { id: 'p3-f3', phase: 'result', timestamp: '00:07.6', neutralCaption: 'Play ends. Interior never returns to frame.', scene: { visibility: 'interior_lost' } },
    ],
    blindFirst: false,
    impliedReasonCode: null,
  },
  {
    id: 'play-4',
    playNumber: 4,
    quarter: 'Q2',
    gameClock: '04:38',
    situation: '3rd & 2, opp 29',
    concept: TEAM.concept,
    playerNumber: 'No. 62',
    position: 'Left Guard',
    candidateGrade: 1,
    gradeConfidence: 'High',
    idConfidence: 'High',
    rationale:
      'Candidate reads the snap as a missed play-side responsibility: the defender crosses the face of the guard and appears in the backfield.',
    observedEvidence: [
      { timestamp: '00:15.2', label: 'First movement: play-side step in the correct direction.', frame: 1 },
      { timestamp: '00:15.9', label: 'Contact made with the down lineman on the combo.', frame: 2 },
      { timestamp: '00:16.8', label: 'A defender appears in the backfield on the play side.', frame: 3 },
    ],
    uncertainty: [
      'The stated evidence does not establish which defender was the guard’s responsibility on the combo.',
      'The climb to the second level is only partly visible.',
      'It is not clear from this angle whether the penetration came through the guard or the adjacent gap.',
    ],
    teamContextVersion: TEAM.rubricVersion,
    filmQuality: { tier: 'Fair', issues: ['Second-level climb only partly visible from this angle.'], gradeableForecast: true },
    storyboard: [
      { id: 'p4-f0', phase: 'presnap', timestamp: '00:14.5', neutralCaption: 'Pre-snap. Offense set, front aligned.', scene: { visibility: 'full', defender: 'aligned' } },
      { id: 'p4-f1', phase: 'first_step', timestamp: '00:15.2', neutralCaption: 'First movement after the snap.', scene: { visibility: 'full', guardStep: 'playside', defender: 'aligned' } },
      { id: 'p4-f2', phase: 'contact', timestamp: '00:15.9', neutralCaption: 'Contact. Guard and center on a combination block.', scene: { visibility: 'full', guardStep: 'playside', combo: true, defender: 'engaged' } },
      { id: 'p4-f3', phase: 'result', timestamp: '00:16.8', neutralCaption: 'A defender is in the backfield. Second level only partly visible.', scene: { visibility: 'partial', combo: true, climbPartial: true, defender: 'penetrating' } },
    ],
    blindFirst: true,
    impliedReasonCode: 'combo_climb',
  },
  {
    id: 'play-5',
    playNumber: 5,
    quarter: 'Q3',
    gameClock: '08:55',
    situation: '2nd & 8, own 22',
    concept: TEAM.concept,
    playerNumber: 'No. 62',
    position: 'Left Guard',
    candidateGrade: 2,
    gradeConfidence: 'Medium',
    idConfidence: 'Medium',
    rationale:
      'Assignment appears correct, but the strike looks high at contact and the hands slide outside the frame of the defender before the block is sustained.',
    observedEvidence: [
      { timestamp: '00:21.7', label: 'First movement: play-side step in the correct direction.', frame: 1 },
      { timestamp: '00:22.3', label: 'Contact with pads high; hands outside the defender’s frame.', frame: 2 },
      { timestamp: '00:23.0', label: 'Block sustained but the defender works back across the track.', frame: 3 },
    ],
    uncertainty: [
      'Jersey number is partially obscured at the snap; identification is medium confidence.',
      'Pad level at contact is judged from a single sideline angle.',
    ],
    teamContextVersion: TEAM.rubricVersion,
    filmQuality: { tier: 'Fair', issues: ['Single sideline angle; jersey partially obscured at the snap.'], gradeableForecast: true },
    storyboard: [
      { id: 'p5-f0', phase: 'presnap', timestamp: '00:21.0', neutralCaption: 'Pre-snap. Jersey number partly obscured.', scene: { visibility: 'full', jerseyObscured: true, defender: 'aligned' } },
      { id: 'p5-f1', phase: 'first_step', timestamp: '00:21.7', neutralCaption: 'First movement after the snap.', scene: { visibility: 'full', guardStep: 'playside', jerseyObscured: true, defender: 'aligned' } },
      { id: 'p5-f2', phase: 'contact', timestamp: '00:22.3', neutralCaption: 'Contact.', scene: { visibility: 'full', hands: 'high_outside', defender: 'engaged' } },
      { id: 'p5-f3', phase: 'result', timestamp: '00:23.0', neutralCaption: 'Block sustained; defender position changes.', scene: { visibility: 'full', hands: 'high_outside', defender: 'working_back' } },
    ],
    blindFirst: false,
    impliedReasonCode: 'hand_placement',
  },
  {
    id: 'play-6',
    playNumber: 6,
    quarter: 'Q4',
    gameClock: '05:20',
    situation: '1st & 10, own 45',
    concept: TEAM.concept,
    playerNumber: 'No. 62',
    position: 'Left Guard',
    candidateGrade: 'NG',
    gradeConfidence: 'Low',
    idConfidence: 'Low',
    rationale:
      'The film on this snap is below what this evaluation needs: a low-resolution re-encode, a zoom push at the snap, and low contrast under the lights. The system is abstaining because the evidence is not there, not because the player performed poorly.',
    observedEvidence: [
      { timestamp: '00:29.4', label: 'Pre-snap alignment is visible but jersey numbers are not legible.', frame: 0 },
      { timestamp: '00:30.1', label: 'Operator zooms toward the backfield at the snap; the interior leaves the frame.', frame: 1 },
    ],
    uncertainty: [
      'Player identification is unresolved; numbers are not legible at this resolution.',
      'First step and point of contact are not visible.',
      'Nothing about the assignment can be established from this angle.',
    ],
    teamContextVersion: TEAM.rubricVersion,
    filmQuality: {
      tier: 'Poor',
      issues: [
        'Low-resolution re-encode (480p, heavy compression).',
        'Zoom push at the snap removes the interior of the line.',
        'Night game; low uniform contrast under the lights.',
      ],
      gradeableForecast: false,
      wouldEnable:
        'The end-zone copy of this snap, or any fixed angle without the zoom push, would likely make it gradable. Elevating the sideline camera would also help every snap in this quarter.',
      degraded: true,
    },
    storyboard: [
      { id: 'p6-f0', phase: 'presnap', timestamp: '00:29.4', neutralCaption: 'Pre-snap. Numbers not legible.', scene: { visibility: 'degraded', jerseyObscured: true, defender: 'aligned' } },
      { id: 'p6-f1', phase: 'first_step', timestamp: '00:30.1', neutralCaption: 'Zoom push toward the backfield at the snap.', scene: { visibility: 'interior_lost' } },
      { id: 'p6-f2', phase: 'contact', timestamp: '00:30.8', neutralCaption: 'Interior of the line is out of frame.', scene: { visibility: 'interior_lost' } },
      { id: 'p6-f3', phase: 'result', timestamp: '00:31.5', neutralCaption: 'Play ends. Interior never returns to frame.', scene: { visibility: 'interior_lost' } },
    ],
    blindFirst: false,
    impliedReasonCode: null,
  },
];

export const DEMO_FILM_LABEL =
  'Demo film — Winchester Hawks vs. Rockbridge (Week 4), offensive series 2 and 5';

export const PROCESSING_STEPS = [
  'Checking film (simulated)',
  'Identifying plays (simulated)',
  'Preparing review candidates (simulated)',
];
