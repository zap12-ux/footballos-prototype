/**
 * FootballOS usability prototype — shared types.
 * All AI results in this prototype are deterministic, hand-authored mock data.
 * No model is called and no video is analyzed.
 */

export type GradeValue = 3 | 2 | 1 | 'NG';

export type ConfidenceBand = 'High' | 'Medium' | 'Low';

export type ScreenId =
  | 'landing'
  | 'intro'
  | 'team'
  | 'film'
  | 'queue'
  | 'review'
  | 'focus'
  | 'summary';

/** Structured reason taxonomy for changing a candidate grade (offensive line). */
export type ChangeReasonCode =
  | 'alignment_stance'
  | 'first_step'
  | 'target_track'
  | 'hand_placement'
  | 'pad_level'
  | 'combo_climb'
  | 'finish'
  | 'ai_misread'
  | 'other';

/** Structured reason taxonomy for a final No Grade decision. */
export type NoGradeReasonCode =
  | 'not_visible'
  | 'identity_unresolved'
  | 'camera_angle'
  | 'film_quality'
  | 'assignment_unclear'
  | 'context_missing'
  | 'other';

export type ReasonCode = ChangeReasonCode | NoGradeReasonCode;

/**
 * One frame of the illustrative storyboard for a play. The storyboard is a
 * schematic stand-in for footage: it is drawn from authored data, it is not
 * tracking output, and it is never presented as real film.
 */
export type FramePhase = 'presnap' | 'first_step' | 'contact' | 'result';

export interface SceneSpec {
  /** What the schematic can "see" in this frame. */
  visibility: 'full' | 'partial' | 'interior_lost' | 'degraded';
  /** Left guard's first-step direction, when shown. */
  guardStep?: 'playside';
  /** Hand placement at or after contact, when shown. */
  hands?: 'inside' | 'not_fitted' | 'high_outside';
  /** Where the primary defender is relative to the guard. */
  defender?: 'aligned' | 'engaged' | 'displaced' | 'working_back' | 'penetrating';
  /** Guard is on a combination block with the center. */
  combo?: boolean;
  /** Second-level climb is only partly visible. */
  climbPartial?: boolean;
  /** Two similar jersey numbers; identity unresolved. */
  identityUnresolved?: boolean;
  /** Jersey number partially obscured at the snap. */
  jerseyObscured?: boolean;
}

export interface StoryboardFrame {
  id: string;
  phase: FramePhase;
  /** Prototype-relative clip time, e.g. "00:12.4". */
  timestamp: string;
  /** Neutral caption shown before a candidate is revealed. Describes the frame, not the grade. */
  neutralCaption: string;
  scene: SceneSpec;
}

export interface EvidenceItem {
  /** Prototype-relative film timestamp, e.g. "00:12.4". */
  timestamp: string;
  label: string;
  /** Index into the play's storyboard. Selecting the evidence selects the frame. */
  frame: number;
}

/**
 * Simulated intake read of the film for one snap. In a real system this would be
 * computed before analysis and per task — a snap can be gradable for one position
 * and not another. Here it is authored mock data.
 */
export interface FilmQuality {
  tier: 'Good' | 'Fair' | 'Poor';
  issues: string[];
  /** Does this snap look gradable for interior offensive line? */
  gradeableForecast: boolean;
  /** What would make an ungradable snap gradable. Shown with the abstention. */
  wouldEnable?: string;
  /** Renders the storyboard as visibly degraded. */
  degraded?: boolean;
}

export interface Play {
  id: string;
  playNumber: number;
  quarter: string;
  gameClock: string;
  /** Down, distance and field position — game context for the queue. */
  situation: string;
  concept: string;
  playerNumber: string;
  position: string;
  candidateGrade: GradeValue;
  /** Confidence in the evaluation itself. Authored, illustrative. */
  gradeConfidence: ConfidenceBand;
  /** Confidence that the tracked player is the named player. Authored, illustrative. */
  idConfidence: ConfidenceBand;
  rationale: string;
  observedEvidence: EvidenceItem[];
  uncertainty: string[];
  teamContextVersion: string;
  filmQuality: FilmQuality;
  storyboard: StoryboardFrame[];
  /** When true, the candidate is withheld until the coach grades independently. */
  blindFirst: boolean;
  /**
   * Deterministic mapping from the simulated candidate's stated issue to the
   * reason taxonomy. Used only when the coach ACCEPTS a 1 or 2 candidate, so
   * the practice focus still traces to a coach-approved finding.
   */
  impliedReasonCode: ChangeReasonCode | null;
}

export type DecisionAction = 'accepted' | 'changed' | 'no_grade';

export interface CoachDecision {
  playId: string;
  playNumber: number;
  candidateGrade: GradeValue;
  candidateGradeConfidence: ConfidenceBand;
  candidateIdConfidence: ConfidenceBand;
  /** Only set on the blind-first play. Stored separately from the final grade. */
  blindGrade?: GradeValue;
  finalGrade: GradeValue;
  action: DecisionAction;
  /** Required for every grade change and every final No Grade (including accepting a No Grade candidate). */
  reasonCodes: ReasonCode[];
  note?: string;
  /**
   * Seconds from the most recent opening of this play to this decision. Reopening
   * a play restarts the clock; only the latest decision's time is kept.
   */
  reviewSeconds: number;
  timestamp: string;
  /** How many times a decision has been recorded for this play (1 = first decision). */
  revision: number;
  /** Blind-first play only: did the coach move to the candidate after reveal? */
  movedTowardCandidate?: boolean;
}

export interface BaselineCapture {
  /** Self-reported minutes to grade six comparable offensive-line snaps today. Null in a demo session. */
  minutesForSixSnaps: number | null;
  method: string;
  timestamp: string;
  /** Always true — the prototype only captures the baseline on the introduction screen (or as a demo placeholder before the queue). */
  capturedBeforeTask: true;
  /** Set only in demo mode: a placeholder that satisfies baseline gating. Never research data. */
  demo?: true;
}

/**
 * research — the instrumented flow (Screens 1–7) with a real baseline captured first.
 * demo     — grader/visitor walkthrough with a placeholder baseline. Exports carry the mode
 *            so demo sessions can never be mixed with research sessions.
 */
export type SessionMode = 'research' | 'demo';

export interface BaselineRevision {
  minutesForSixSnaps: number;
  timestamp: string;
  note: 'Revised on summary screen; original estimate retained.';
}

export interface ResearchEvent {
  event: string;
  sessionId: string;
  /** Milliseconds since the prototype session started. */
  tMs: number;
  playId?: string;
  data?: Record<string, string | number | boolean | null>;
}

export interface Feedback {
  evidenceUnderstandable: string;
  confidenceUnderstandable: string;
  gradeOneVsNoGradeClear: string;
  correctionEasy: string;
  reasonsMatchThinking: string;
  practiceFocusUseful: string;
  wouldUseGameWeek: string;
  appearedToSaveTime: string;
  trustRating: number | null;
  remainingConcerns: string;
  comments: string;
  willingToTest: string;
}

/**
 * pending  — not yet reviewed by the coach
 * accepted / edited / dismissed — coach decision recorded
 * stale    — a play decision changed after the coach reviewed the focus; renewed review required
 */
export type RecommendationState = 'pending' | 'accepted' | 'edited' | 'dismissed' | 'stale';

export type PracticeFocusKind = 'focus' | 'maintain' | 'insufficient';

export interface FocusFinding {
  playNumber: number;
  reasonCode: ChangeReasonCode;
  label: string;
  source: 'coach_changed' | 'accepted_candidate';
}

export interface PracticeFocus {
  kind: PracticeFocusKind;
  focusTitle: string;
  teachingCue: string;
  supportingPoints: string[];
  supportingPlayNumbers: number[];
  /** Coach-approved findings that fed the focus (graded plays only). */
  findings: FocusFinding[];
  /** Reasons recorded on graded plays that are logged but deliberately not treated as player deficiencies. */
  nonTeachingNotes: string[];
  coverageStatement: string;
  gradedCount: number;
  reviewedCount: number;
  excludedPlayNumbers: number[];
  unreviewedPlayNumbers: number[];
  driverReasonCode: ChangeReasonCode | null;
}

export interface SessionState {
  schemaVersion: 2;
  sessionId: string;
  /** Defaults to 'research' when absent so saved v2 sessions still load. */
  mode: SessionMode;
  /**
   * When a saved session is reopened, the visitor lands on the landing page and this holds
   * the screen to return to via "Resume your session". Null when nothing is pending.
   */
  resumeScreen: ScreenId | null;
  startedAtIso: string | null;
  /** epoch ms when the coach pressed Begin Review. */
  startedAtMs: number | null;
  screen: ScreenId;
  baseline: BaselineCapture | null;
  baselineRevision: BaselineRevision | null;
  filmSource: 'demo' | 'local' | null;
  filmLabel: string | null;
  /** Host of a pasted video link. Recorded as an intake-preference signal only; the URL itself is not kept. */
  filmLinkHost: string | null;
  decisions: Record<string, CoachDecision>;
  /** Blind-first play only: the coach's independent grade, stored separately. */
  blindGrades: Record<string, GradeValue>;
  /** Blind-first play only: whether the simulated candidate has been revealed. */
  revealed: Record<string, boolean>;
  activePlayId: string | null;
  recommendationState: RecommendationState;
  recommendationEdit: string | null;
  /** ISO time of the last accept/edit/dismiss on the practice focus. */
  recommendationReviewedAt: string | null;
  feedback: Feedback | null;
  events: ResearchEvent[];
}
