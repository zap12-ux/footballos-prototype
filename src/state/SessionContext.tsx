import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type {
  BaselineCapture,
  CoachDecision,
  ExposureRecord,
  Feedback,
  GradeValue,
  RecommendationState,
  ReviewInterval,
  ScreenId,
  SessionState,
} from '../types';
import { loadSession, saveSession, clearSession } from '../utils/storage';
import { parseHash, type Route } from '../utils/routes';
import { DEMO_FILM_LABEL } from '../data/plays';
import {
  EXPOSURE_NOTE,
  readExposure,
  recordDemoStarted,
  recordLandingViewed,
} from '../utils/exposure';
import { accumulatedSecondsForPlay } from '../utils/reviewTime';

function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `fos-${Date.now().toString(36)}-${rand}`;
}

export function initialState(): SessionState {
  return {
    schemaVersion: 2,
    sessionId: newSessionId(),
    mode: 'research',
    resumeScreen: null,
    startedAtIso: null,
    startedAtMs: null,
    screen: 'landing',
    baseline: null,
    baselineRevisions: [],
    landingViewedAtIso: null,
    researchEntry: null,
    timingSchema: 'accumulated_v1',
    reviewIntervals: [],
    openReview: null,
    filmSource: null,
    filmLabel: null,
    filmLinkHost: null,
    decisions: {},
    blindGrades: {},
    revealed: {},
    activePlayId: null,
    recommendationState: 'pending',
    recommendationEdit: null,
    recommendationReviewedAt: null,
    feedback: null,
    events: [],
  };
}

/** What the research entry form submits. Timestamp, flag and browser-side exposure flags are added by the reducer. */
export interface BaselineSubmission {
  minutesForSixSnaps: number | null;
  estimateStatus: 'provided' | 'not_sure';
  method: string;
  selfReportedPriorExposure: ExposureRecord['selfReportedPriorExposure'];
}

export type Action =
  | { type: 'log'; event: string; playId?: string; data?: Record<string, string | number | boolean | null> }
  | { type: 'captureBaseline'; baseline: BaselineSubmission }
  | { type: 'begin' }
  | { type: 'goto'; screen: ScreenId }
  | { type: 'selectFilm'; source: 'demo' | 'local'; label: string }
  | { type: 'recordFilmLink'; url: string }
  | { type: 'openPlay'; playId: string }
  | { type: 'submitBlindGrade'; playId: string; grade: GradeValue }
  | { type: 'revealCandidate'; playId: string }
  /** `reviewSeconds` is filled in by the reducer from the accumulated intervals. */
  | { type: 'recordDecision'; decision: Omit<CoachDecision, 'revision' | 'reviewSeconds'> & { reviewSeconds?: number }; atMs?: number }
  | { type: 'addNote'; playId: string; note: string }
  | { type: 'setRecommendation'; state: Exclude<RecommendationState, 'pending' | 'stale'>; edit?: string | null }
  | { type: 'submitFeedback'; feedback: Feedback }
  | { type: 'reviseBaseline'; minutes: number }
  | { type: 'restart' }
  /** Enter the research flow at the research entry screen (baseline first). Replaces any saved session. */
  | { type: 'startResearch'; via?: 'research_link' | 'landing_page' }
  /** Demo mode. No baseline is collected; straight to the review queue. Replaces any saved session. */
  | { type: 'startDemo' }
  /** The landing page rendered: example AI output has now been shown in this session. */
  | { type: 'markLandingViewed' }
  /** Landing page: return to the screen a saved session was on. */
  | { type: 'resume' }
  /** Review timing: the play-review screen is open and visible for this play. No-op if already open for it. */
  | { type: 'reviewOpen'; playId: string; atMs?: number }
  /** Review timing: close the open interval, if any. */
  | { type: 'reviewClose'; closedBy: ReviewInterval['closedBy']; atMs?: number }
  /** Review timing: heartbeat while the screen is open, so a reload can close the interval at a known time. */
  | { type: 'reviewTick'; atMs?: number }
  /**
   * The URL hash changed after load (typed URL, Back/Forward). Applies the route only when
   * it can do so without discarding anything; otherwise the state is returned unchanged
   * and the caller re-syncs the hash.
   */
  | { type: 'applyRoute'; route: Route };

/**
 * A session that has not started anything: no baseline, no timer, no decisions. Such a
 * session can be replaced by a deep link without losing anything.
 */
export function isBlankSession(state: SessionState): boolean {
  return (
    state.startedAtMs === null &&
    state.baseline === null &&
    Object.keys(state.decisions).length === 0 &&
    state.filmSource === null
  );
}

/**
 * Decide the first screen from the saved session and the URL hash (read once on load).
 * - A saved session with anything in it lands on the landing page with "Resume your session"
 *   rather than dropping the visitor mid-flow. Deep links never destroy a saved session.
 * - Otherwise the hash picks the entry: #/demo, #/research, or the landing page.
 */
export function resolveInitialState(saved: SessionState | null, hash: string): SessionState {
  if (saved && !isBlankSession(saved)) {
    if (saved.screen === 'landing') return saved;
    return { ...saved, screen: 'landing', resumeScreen: saved.screen };
  }
  const fresh = initialState();
  const route = parseHash(hash);
  if (route === 'demo') return reducer(fresh, { type: 'startDemo' });
  if (route === 'research') return reducer(fresh, { type: 'startResearch', via: 'research_link' });
  return fresh;
}

/** Only the host of a pasted link is ever kept. The URL itself is discarded. */
export function safeHost(url: string): string {
  try {
    return new URL(url).host || 'unparsed';
  } catch {
    return 'unparsed';
  }
}

function withEvent(
  state: SessionState,
  event: string,
  playId?: string,
  data?: Record<string, string | number | boolean | null>,
): SessionState {
  const base = state.startedAtMs ?? Date.now();
  return {
    ...state,
    events: [
      ...state.events,
      {
        event,
        sessionId: state.sessionId,
        tMs: state.startedAtMs ? Date.now() - base : 0,
        ...(playId ? { playId } : {}),
        ...(data ? { data } : {}),
      },
    ],
  };
}

/** Close the open review interval, if any. Zero-length intervals are dropped. */
function closeReview(
  state: SessionState,
  closedBy: ReviewInterval['closedBy'],
  atMs: number,
): SessionState {
  const open = state.openReview;
  if (!open) return state;
  const endMs = Math.max(atMs, open.lastTickMs);
  if (endMs <= open.startMs) return { ...state, openReview: null };
  return {
    ...state,
    openReview: null,
    reviewIntervals: [
      ...state.reviewIntervals,
      { playId: open.playId, startMs: open.startMs, endMs, closedBy },
    ],
  };
}

function openReview(state: SessionState, playId: string, atMs: number): SessionState {
  if (state.openReview?.playId === playId) return state;
  const closed = closeReview(state, 'navigation', atMs);
  return { ...closed, openReview: { playId, startMs: atMs, lastTickMs: atMs } };
}

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'log':
      return withEvent(state, action.event, action.playId, action.data);

    case 'captureBaseline': {
      // The original submission is kept as is; later revisions go to `baselineRevisions`.
      if (state.baseline) return state;
      const now = new Date().toISOString();
      const store = readExposure();
      const landingSeenThisVisit = state.landingViewedAtIso !== null;
      const exposure: ExposureRecord = {
        enteredVia: state.researchEntry ?? 'research_link',
        landingPageSeenThisVisit: landingSeenThisVisit,
        priorDemoRecordedInThisBrowser: store.lastDemoStartedAt !== null,
        priorLandingViewRecordedInThisBrowser:
          store.firstLandingViewedAt !== null &&
          (state.landingViewedAtIso === null || store.firstLandingViewedAt < state.landingViewedAtIso),
        selfReportedPriorExposure: action.baseline.selfReportedPriorExposure,
        note: EXPOSURE_NOTE,
      };
      const baseline: BaselineCapture = {
        minutesForSixSnaps:
          action.baseline.estimateStatus === 'provided' ? action.baseline.minutesForSixSnaps : null,
        estimateStatus: action.baseline.estimateStatus,
        method: action.baseline.method,
        timestamp: now,
        capturedBeforeReviewTask: true,
        exposure,
      };
      return withEvent({ ...state, baseline }, 'baseline_captured', undefined, {
        minutes: baseline.minutesForSixSnaps,
        estimateStatus: baseline.estimateStatus,
        method: baseline.method,
        enteredVia: exposure.enteredVia,
        landingPageSeenThisVisit: exposure.landingPageSeenThisVisit,
        priorDemoRecordedInThisBrowser: exposure.priorDemoRecordedInThisBrowser,
        selfReportedPriorExposure: exposure.selfReportedPriorExposure,
      });
    }

    case 'begin': {
      const now = Date.now();
      const started: SessionState = {
        ...state,
        startedAtMs: now,
        startedAtIso: new Date(now).toISOString(),
        screen: 'team',
      };
      return withEvent(started, 'session_started');
    }

    case 'goto': {
      const left = closeReview(state, 'navigation', Date.now());
      return withEvent({ ...left, screen: action.screen }, `screen_${action.screen}`);
    }

    case 'selectFilm':
      return withEvent(
        { ...state, filmSource: action.source, filmLabel: action.label },
        action.source === 'demo' ? 'demo_film_selected' : 'local_film_selected',
      );

    case 'recordFilmLink': {
      // Intake-preference signal only. Nothing is fetched and the URL is not stored.
      const host = safeHost(action.url);
      return withEvent({ ...state, filmLinkHost: host }, 'film_link_pasted', undefined, { host });
    }

    case 'openPlay': {
      const left = closeReview(state, 'navigation', Date.now());
      return withEvent(
        { ...left, activePlayId: action.playId, screen: 'review' },
        'play_opened',
        action.playId,
        { previousVisits: state.reviewIntervals.filter((i) => i.playId === action.playId).length },
      );
    }

    case 'reviewOpen':
      return openReview(state, action.playId, action.atMs ?? Date.now());

    case 'reviewClose':
      return closeReview(state, action.closedBy, action.atMs ?? Date.now());

    case 'reviewTick': {
      if (!state.openReview) return state;
      const at = action.atMs ?? Date.now();
      if (at <= state.openReview.lastTickMs) return state;
      return { ...state, openReview: { ...state.openReview, lastTickMs: at } };
    }

    case 'submitBlindGrade':
      return withEvent(
        {
          ...state,
          blindGrades: { ...state.blindGrades, [action.playId]: action.grade },
        },
        'blind_grade_submitted',
        action.playId,
        { blindGrade: String(action.grade) },
      );

    case 'revealCandidate':
      return withEvent(
        { ...state, revealed: { ...state.revealed, [action.playId]: true } },
        'candidate_revealed',
        action.playId,
      );

    case 'recordDecision': {
      const previous = state.decisions[action.decision.playId];
      const atMs = action.atMs ?? Date.now();
      // Accumulated across every visit so far. Saving does not touch the intervals, so a
      // second save seconds later reports the same stretch of time once, slightly longer.
      const reviewSeconds =
        state.timingSchema === 'accumulated_v1'
          ? accumulatedSecondsForPlay(state, action.decision.playId, atMs)
          : action.decision.reviewSeconds ?? previous?.reviewSeconds ?? 0;
      const d: CoachDecision = {
        ...action.decision,
        reviewSeconds,
        revision: (previous?.revision ?? 0) + 1,
      };
      let next: SessionState = {
        ...state,
        decisions: { ...state.decisions, [d.playId]: d },
      };
      const eventName =
        d.action === 'accepted'
          ? 'candidate_accepted'
          : d.action === 'no_grade'
            ? 'no_grade_selected'
            : 'grade_changed';
      // Every decision, original or revised, is kept in the event history with its
      // predecessor's grade so the revision trail can be read back.
      next = withEvent(next, eventName, d.playId, {
        action: d.action,
        candidateGrade: String(d.candidateGrade),
        finalGrade: String(d.finalGrade),
        previousFinalGrade: previous ? String(previous.finalGrade) : null,
        reasonCodes: d.reasonCodes.join('|') || null,
        reviewSeconds: d.reviewSeconds,
        revision: d.revision,
        blindGrade: d.blindGrade !== undefined ? String(d.blindGrade) : null,
      });
      // A reviewed practice focus is built from decisions. If a decision changes, the
      // focus is stale and must be reviewed again — never silently kept.
      if (state.recommendationState !== 'pending' && state.recommendationState !== 'stale') {
        next = withEvent(
          { ...next, recommendationState: 'stale' },
          'recommendation_invalidated',
          d.playId,
          { previousState: state.recommendationState },
        );
      }
      return next;
    }

    case 'addNote': {
      const existing = state.decisions[action.playId];
      if (!existing) return state;
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.playId]: { ...existing, note: action.note },
        },
      };
    }

    case 'setRecommendation':
      return withEvent(
        {
          ...state,
          recommendationState: action.state,
          recommendationEdit:
            action.edit !== undefined ? action.edit : state.recommendationEdit,
          recommendationReviewedAt: new Date().toISOString(),
        },
        `recommendation_${action.state}`,
      );

    case 'submitFeedback':
      return withEvent({ ...state, feedback: action.feedback }, 'feedback_submitted', undefined, {
        trustRating: action.feedback.trustRating,
        willingToTest: action.feedback.willingToTest,
      });

    case 'reviseBaseline': {
      // Demo sessions have no baseline to revise.
      if (state.mode === 'demo' || !state.baseline) return state;
      return withEvent(
        {
          ...state,
          baselineRevisions: [
            ...state.baselineRevisions,
            {
              minutesForSixSnaps: action.minutes,
              timestamp: new Date().toISOString(),
              note: 'Revised on summary screen; original estimate retained.',
            },
          ],
        },
        'baseline_revised',
        undefined,
        { minutes: action.minutes, revisionNumber: state.baselineRevisions.length + 1 },
      );
    }

    case 'restart': {
      clearSession();
      return initialState();
    }

    case 'startResearch': {
      // Research entry: the baseline is captured before anything about the workflow is shown.
      // Whether the landing page (which shows example output) was seen first is kept.
      const via = action.via ?? 'research_link';
      const fresh: SessionState = {
        ...initialState(),
        mode: 'research',
        screen: 'intro',
        researchEntry: via,
        landingViewedAtIso: via === 'landing_page' ? state.landingViewedAtIso ?? new Date().toISOString() : null,
      };
      return withEvent(fresh, 'research_entry_selected', undefined, { via });
    }

    case 'markLandingViewed': {
      if (state.landingViewedAtIso) return state;
      const iso = new Date().toISOString();
      recordLandingViewed(iso);
      return { ...state, landingViewedAtIso: iso };
    }

    case 'startDemo': {
      // Demo mode: the visitor sees the real trust mechanics. No baseline is collected and
      // none is fabricated: `baseline` stays null and the export carries `mode: 'demo'`.
      const now = Date.now();
      const iso = new Date(now).toISOString();
      recordDemoStarted(iso);
      const fresh: SessionState = {
        ...initialState(),
        mode: 'demo',
        startedAtMs: now,
        startedAtIso: iso,
        landingViewedAtIso: state.landingViewedAtIso,
        baseline: null,
        filmSource: 'demo',
        filmLabel: DEMO_FILM_LABEL,
        screen: 'queue',
      };
      return withEvent(fresh, 'demo_started', undefined, { mode: 'demo', baseline: 'none' });
    }

    case 'applyRoute': {
      if (action.route === 'landing') {
        if (state.screen === 'landing') return state;
        const left = closeReview(state, 'navigation', Date.now());
        return {
          ...left,
          screen: 'landing',
          resumeScreen: isBlankSession(left) ? null : left.screen,
        };
      }
      const wanted = action.route === 'demo' ? 'demo' : 'research';
      if (isBlankSession(state)) {
        return reducer(
          state,
          wanted === 'demo'
            ? { type: 'startDemo' }
            : { type: 'startResearch', via: state.landingViewedAtIso ? 'landing_page' : 'research_link' },
        );
      }
      // A saved session in the same mode can be resumed from the landing page; a saved
      // session in the other mode is never replaced by a URL change.
      if (state.mode === wanted && state.screen === 'landing' && state.resumeScreen) {
        return reducer(state, { type: 'resume' });
      }
      return state;
    }

    case 'resume': {
      const target = state.resumeScreen ?? 'queue';
      return withEvent(
        { ...state, screen: target, resumeScreen: null },
        'session_resumed',
        undefined,
        { screen: target },
      );
    }

    default:
      return state;
  }
}

interface SessionContextValue {
  state: SessionState;
  dispatch: Dispatch<Action>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  seed,
}: {
  children: ReactNode;
  seed?: SessionState;
}) {
  const [state, dispatch] = useReducer(reducer, undefined, () =>
    seed
      ? seed
      : resolveInitialState(
          loadSession(),
          typeof window !== 'undefined' ? window.location.hash : '',
        ),
  );

  useEffect(() => {
    saveSession(state);
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
