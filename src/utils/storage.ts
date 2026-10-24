import type { SessionState } from '../types';

/** Bumped when the stored shape changes. Older sessions are ignored, never migrated silently. */
export const STORAGE_KEY = 'footballos.prototype.v2';

/** All prototype research data stays in this browser. Nothing is transmitted. */
export function loadSession(): SessionState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessionId) return null;
    if (parsed.schemaVersion !== 2) return null;
    // Sessions saved before demo mode existed have no `mode`; they were all research sessions.
    return {
      ...(parsed as SessionState),
      mode: parsed.mode === 'demo' ? 'demo' : 'research',
      resumeScreen: parsed.resumeScreen ?? null,
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
