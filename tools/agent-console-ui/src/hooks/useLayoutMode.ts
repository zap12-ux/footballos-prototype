import { useEffect, useState } from 'react';

/**
 * Responsive layout modes (QA defect D-2). The old layout had `.app { min-width: 1024px }`, which
 * pushed the docked drawer off-screen in narrower windows. Now:
 *  - below DRAWER_OVERLAY_BELOW px the drawer is an overlay panel (full height, max 480 px wide,
 *    close button always visible, Escape closes, focus trapped and returned);
 *  - below QUEUE_COLLAPSE_BELOW px the queue collapses to a toggle and opens as an overlay list.
 * The layout is usable from 720 px up.
 */
export const DRAWER_OVERLAY_BELOW = 1180;
export const QUEUE_COLLAPSE_BELOW = 960;

export type DrawerMode = 'docked' | 'overlay';
export type QueueMode = 'docked' | 'collapsed';

export interface LayoutMode {
  drawerMode: DrawerMode;
  queueMode: QueueMode;
}

export const DRAWER_OVERLAY_QUERY = `(max-width: ${DRAWER_OVERLAY_BELOW - 1}px)`;
export const QUEUE_COLLAPSE_QUERY = `(max-width: ${QUEUE_COLLAPSE_BELOW - 1}px)`;

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** True while the media query matches; re-renders on change. Without matchMedia (old jsdom) it is false. */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    const update = () => setOn(mql.matches);
    update();
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => mql.removeEventListener('change', update);
    }
    // Safari < 14
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, [query]);
  return on;
}

export function useLayoutMode(): LayoutMode {
  const overlay = useMediaQuery(DRAWER_OVERLAY_QUERY);
  const collapsed = useMediaQuery(QUEUE_COLLAPSE_QUERY);
  return { drawerMode: overlay ? 'overlay' : 'docked', queueMode: collapsed ? 'collapsed' : 'docked' };
}
