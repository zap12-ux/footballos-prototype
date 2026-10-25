import type { SessionState } from '../types';

/**
 * Hash routes. GitHub Pages serves a static build with no server rewrites, so the
 * three entry points live in the URL hash:
 *
 *   #/           (or no hash)  → landing page
 *   #/demo                     → demo mode: placeholder baseline, straight to the review queue
 *   #/research                 → the instrumented research flow (Screen 1, baseline first)
 *
 * The hash is read once on load and written whenever the mode or entry changes.
 * No router library is used.
 */
export type Route = 'landing' | 'demo' | 'research';

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
  if (h === 'demo') return 'demo';
  if (h === 'research') return 'research';
  return 'landing';
}

/** The hash that should be shown for the current state. */
export function hashFor(state: SessionState): string {
  if (state.screen === 'landing') return '#/';
  return state.mode === 'demo' ? '#/demo' : '#/research';
}

export function syncHash(state: SessionState): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') return;
  const target = hashFor(state);
  if (window.location.hash !== target) {
    try {
      window.history.replaceState(null, '', target);
    } catch {
      /* ignore — the app still works without the hash */
    }
  }
}
