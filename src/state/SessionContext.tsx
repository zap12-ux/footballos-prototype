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
  Feedback,
  GradeValue,
  RecommendationState,
  ScreenId,
  SessionState,
} from '../types';
import { loadSession, saveSession, clearSession } from '../utils/storage';
import { parseHash } from '../utils/routes';
import { DEMO_FILM_LABEL } from '../data/plays';

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
    baselineRevision: null,
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

export type Action =
  | { type: 'log'; event: string; playId?: string; data?: Record<string, string | number | boolean | null> }
  | { type: 'captureBaseline'; baseline: Omit<BaselineCapture, 'timestamp' | 'capturedBeforeTask'> }
  | { type: 'begin' }
  | { type: 'goto'; screen: ScreenId }
  | { type: 'selectFilm'; source: 'demo' | 'local'; label: string }
  | { type: 'recordFilmLink'; url: string }
  | { type: 'openPlay'; playId: string }
  | { type: 'submitBlindGrade'; playId: string; grade: GradeValue }
  | { type: 'revealCandidate'; playId: string }
  | { type: 'recordDecision'; decision: Omit<CoachDecision, 'revision'> }
  | { type: 'addNote'; playId: string; note: string }
  | { type: 'setRecommendation'; state: Exclude<RecommendationState, 'pending' | 'stale'>; edit?: string | null }
  | { type: 'submitFeedback'; feedback: Feedback }
  | { type: 'reviseBaseline'; minutes: number }
  | { type: 'restart' }
  /** Landing page: enter the instrumented research flow at Screen 1 (baseline first). Replaces any saved session. */
  | { type: 'startResearch' }
  /** Landing page: demo mode. Placeholder baseline, straight to the review queue. Replaces any saved session. */
  | { type: 'startDemo' }
  /** Landing page: return to the screen a saved session was on. */
  | { type: 'resume' };

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
  if (route === 'research') return reducer(fresh, { type: 'startResearch' });
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

export function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case 'log':
      return withEvent(state, action.event, action.playId, action.data);

    case 'captureBaseline': {
      const baseline: BaselineCapture = {
        ...action.baseline,
        timestamp: new Date().toISOString(),
        capturedBeforeTask: true,
      };
      return withEvent({ ...state, baseline }, 'baseline_captured', undefined, {
        minutes: baseline.minutesForSixSnaps,
        method: baseline.method,
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

    case 'goto':
      return withEvent({ ...state, screen: action.screen }, `screen_${action.screen}`);

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

    case 'openPlay':
      return withEvent(
        { ...state, activePlayId: action.playId, screen: 'review' },
        'play_opened',
        action.playId,
      );

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
      const d: CoachDecision = { ...action.decision, revision: (previous?.revision ?? 0) + 1 };
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
      next = withEvent(next, eventName, d.playId, {
        candidateGrade: String(d.candidateGrade),
        finalGrade: String(d.finalGrade),
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

    case 'reviseBaseline':
      return withEvent(
        {
          ...state,
          baselineRevision: {
            minutesForSixSnaps: action.minutes,
            timestamp: new Date().toISOString(),
            note: 'Revised on summary screen; original estimate retained.',
          },
        },
        'baseline_revised',
        undefined,
        { minutes: action.minutes },
      );

    case 'restart': {
      clearSession();
      return initialState();
    }

    case 'startResearch': {
      // Research mode is the existing flow: Screen 1 captures the baseline before anything else.
      const fresh: SessionState = { ...initialState(), mode: 'research', screen: 'intro' };
      return withEvent(fresh, 'research_entry_selected');
    }

    case 'startDemo': {
      // Demo mode: the visitor sees the real trust mechanics without being asked for a
      // baseline estimate. The placeholder baseline is flagged `demo: true` so it is never
      // read as research data, and the export carries `mode: 'demo'`.
      const now = Date.now();
      const fresh: SessionState = {
        ...initialState(),
        mode: 'demo',
        startedAtMs: now,
        startedAtIso: new Date(now).toISOString(),
        baseline: {
          minutesForSixSnaps: null,
          method: 'Demo session — no baseline collected',
          timestamp: new Date(now).toISOString(),
          capturedBeforeTask: true,
          demo: true,
        },
        filmSource: 'demo',
        filmLabel: DEMO_FILM_LABEL,
        screen: 'queue',
      };
      return withEvent(fresh, 'demo_started', undefined, { mode: 'demo' });
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
