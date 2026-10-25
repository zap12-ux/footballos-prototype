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
   * Review seconds accumulated for this play across every visit (closed review
   * intervals plus the open one) at the moment this decision was saved. Reopening a
   * play never resets it. In sessions saved before accumulated timing existed
   * (`timingSchema: 'legacy_latest_visit'`) this is the seconds from the most recent
   * opening of the play to the decision, and is labelled as such.
   */
  reviewSeconds: number;
  timestamp: string;
  /** How many times a decision has been recorded for this play (1 = first decision). */
  revision: number;
  /** Blind-first play only: did the coach move to the candidate after reveal? */
  movedTowardCandidate?: boolean;
}

/**
 * What is known about the participant's exposure to the prototype before the baseline
 * was submitted. Browser records can show that something WAS seen in this browser; they
 * can never prove that nothing was seen elsewhere, so "false" means "none recorded".
 */
export interface ExposureRecord {
  /** How the research entry screen was reached. */
  enteredVia: 'research_link' | 'landing_page';
  /** The landing page (example candidates, confidence labels, evidence) rendered in this browser visit before the baseline was submitted. */
  landingPageSeenThisVisit: boolean;
  /** A demo session was started in this browser at some earlier time (separate storage key). */
  priorDemoRecordedInThisBrowser: boolean;
  /** The landing page was viewed in this browser at some earlier time (separate storage key). */
  priorLandingViewRecordedInThisBrowser: boolean;
  /** The participant's own answer to "Have you seen this prototype or a demonstration of it before today?" */
  selfReportedPriorExposure: 'no' | 'yes' | 'not_sure';
  /** Fixed caveat written into the record so a reader never over-interprets the flags. */
  note: string;
}

export interface BaselineCapture {
  /** Self-reported minutes to grade six comparable offensive-line snaps. Null when the coach chose "I'm not sure". */
  minutesForSixSnaps: number | null;
  /** 'not_sure' records a missing estimate rather than an invented number. */
  estimateStatus: 'provided' | 'not_sure';
  method: string;
  timestamp: string;
  /**
   * Always true: the research entry screen is the only place a baseline is captured, and the
   * review task (team context, film, queue, plays) cannot start before it. This says nothing
   * about exposure before this visit; see `exposure`.
   */
  capturedBeforeReviewTask: true;
  /** Null only for sessions saved before exposure tracking existed. */
  exposure: ExposureRecord | null;
}

/**
 * research — the instrumented flow with a baseline captured on the research entry screen
 *            before the review task.
 * demo     — grader/visitor walkthrough. No baseline is collected (`baseline` stays null).
 *            Exports carry the mode so demo sessions can never be mixed with research sessions.
 */
export type SessionMode = 'research' | 'demo';

/** A later revision of the estimate. The original submission is never overwritten. */
export interface BaselineRevision {
  minutesForSixSnaps: number;
  timestamp: string;
  note: 'Revised on summary screen; original estimate retained.';
}

/**
 * One stretch of time during which the play-review screen was open for a play and the
 * tab was visible. Intervals never overlap: at most one is open at a time, and reopening
 * a play adds a new interval rather than replacing earlier ones.
 */
export interface ReviewInterval {
  playId: string;
  startMs: number;
  endMs: number;
  /** Why the interval ended. `recovered_on_load` means the page was closed or reloaded with the interval open; it was closed at the last recorded tick. */
  closedBy: 'navigation' | 'tab_hidden' | 'page_hidden' | 'recovered_on_load';
}

export interface OpenReview {
  playId: string;
  startMs: number;
  /** Advanced every few seconds while the screen is open and visible; the fallback end time if the page goes away without closing the interval. */
  lastTickMs: number;
}

/**
 * accumulated_v1      — review time is the sum of `reviewIntervals` per play.
 * legacy_latest_visit — a session saved before intervals existed; only each decision's
 *                       latest-visit `reviewSeconds` survives, and no cumulative time is derived.
 */
export type TimingSchema = 'accumulated_v1' | 'legacy_latest_visit';

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

/**
 * insufficient — no reviewed play has a coach grade (all No Grade or nothing reviewed).
 * reinforce    — every coach-graded play is Grade 3; reinforce, limited to those plays.
 * clarify      — at least one final grade is 1 or 2 but no usable technique finding exists;
 *                the grade says there is a problem, the recorded reason does not say what to coach.
 * focus        — coach-approved technique findings exist and drive a focus.
 */
export type PracticeFocusKind = 'focus' | 'reinforce' | 'clarify' | 'insufficient';

/** A graded play whose final grade is below the standard but that carries no technique finding. */
export interface UnresolvedPlay {
  playNumber: number;
  playId: string;
  finalGrade: 1 | 2;
  /** The reasons actually recorded (review reasons such as "AI misread the assignment", or none). */
  recordedReasonLabels: string[];
  /** Why it could not feed the focus. */
  why: string;
}

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
  /** How many distinct plays support the driver finding. 'single' must never be described as recurring. */
  driverSupport: 'none' | 'single' | 'recurring';
  /** Below-standard plays (final 1 or 2) that carry no technique finding. Shown as a limitation, never as the standard being met. */
  unresolvedPlays: UnresolvedPlay[];
  /** Plain statements of what this result does and does not cover. */
  limitations: string[];
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
  /** Null in demo mode and before the research entry form is submitted. */
  baseline: BaselineCapture | null;
  /** Every later revision, oldest first. The original `baseline` is never changed. */
  baselineRevisions: BaselineRevision[];
  /** ISO time the landing page (which shows example AI output) first rendered in this session; null if it never did. */
  landingViewedAtIso: string | null;
  /** How the research flow was entered. Null until a research entry is chosen. */
  researchEntry: 'research_link' | 'landing_page' | null;
  timingSchema: TimingSchema;
  /** Closed review intervals, in order. Empty for legacy sessions. */
  reviewIntervals: ReviewInterval[];
  /** The interval currently open on the play-review screen, if any. */
  openReview: OpenReview | null;
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
