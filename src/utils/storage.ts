import type {
  BaselineCapture,
  BaselineRevision,
  ReviewInterval,
  SessionState,
} from '../types';

/**
 * Storage key. The shape has grown since v2 was first written; older v2 records are
 * migrated field by field on load rather than discarded. Fields that cannot be derived
 * from an old record are marked as unavailable (for example `timingSchema:
 * 'legacy_latest_visit'`), never invented.
 */
export const STORAGE_KEY = 'footballos.prototype.v2';

/** Shape of a v2 record as any earlier version of the prototype may have written it. */
interface StoredV2 extends Partial<Omit<SessionState, 'baseline'>> {
  baseline?: (Partial<BaselineCapture> & { capturedBeforeTask?: true; demo?: true }) | null;
  /** Pre-October-24 shape: a single revision. */
  baselineRevision?: BaselineRevision | null;
}

function migrateBaseline(raw: StoredV2['baseline']): BaselineCapture | null {
  if (!raw) return null;
  // Demo sessions used to carry a placeholder baseline. There was never a real estimate in it.
  if (raw.demo) return null;
  const minutes = typeof raw.minutesForSixSnaps === 'number' ? raw.minutesForSixSnaps : null;
  return {
    minutesForSixSnaps: minutes,
    estimateStatus: raw.estimateStatus ?? (minutes === null ? 'not_sure' : 'provided'),
    method: raw.method ?? '',
    timestamp: raw.timestamp ?? '',
    capturedBeforeReviewTask: true,
    exposure: raw.exposure ?? null,
  };
}

/** All prototype research data stays in this browser. Nothing is transmitted. */
export function loadSession(): SessionState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredV2;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessionId) return null;
    if (parsed.schemaVersion !== 2) return null;

    const hadIntervals = Array.isArray(parsed.reviewIntervals);
    const intervals: ReviewInterval[] = hadIntervals ? [...(parsed.reviewIntervals as ReviewInterval[])] : [];
    // An interval left open means the page was closed or reloaded on the review screen.
    // Close it at the last recorded tick; the time after that tick is unknown and not counted.
    if (parsed.openReview && parsed.openReview.lastTickMs > parsed.openReview.startMs) {
      intervals.push({
        playId: parsed.openReview.playId,
        startMs: parsed.openReview.startMs,
        endMs: parsed.openReview.lastTickMs,
        closedBy: 'recovered_on_load',
      });
    }

    const revisions: BaselineRevision[] = Array.isArray(parsed.baselineRevisions)
      ? parsed.baselineRevisions
      : parsed.baselineRevision
        ? [parsed.baselineRevision]
        : [];

    const { baselineRevision: _legacyRevision, ...rest } = parsed;
    void _legacyRevision;
    return {
      ...(rest as SessionState),
      // Sessions saved before demo mode existed have no `mode`; they were all research sessions.
      mode: parsed.mode === 'demo' ? 'demo' : 'research',
      resumeScreen: parsed.resumeScreen ?? null,
      baseline: migrateBaseline(parsed.baseline),
      baselineRevisions: revisions,
      landingViewedAtIso: parsed.landingViewedAtIso ?? null,
      researchEntry: parsed.researchEntry ?? null,
      timingSchema: parsed.timingSchema ?? (hadIntervals ? 'accumulated_v1' : 'legacy_latest_visit'),
      reviewIntervals: intervals,
      openReview: null,
    };
  } catch {
    return null;
  }
}

export function saveSession(state: SessionState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Storage may be unavailable (private mode). The prototype still runs. */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
