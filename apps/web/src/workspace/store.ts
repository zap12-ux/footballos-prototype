import { useSyncExternalStore } from 'react';
import type { Unit } from '../api/contracts';

/**
 * The context every workspace page agrees on: team, season, game (opponent / week) and
 * unit. The URL query (`?team=&season=&game=&unit=`) is the source of truth while a page
 * is open; this store mirrors the last resolved selection so that links built anywhere in
 * the shell carry it, and so `/app` without a query reopens where the coach left off.
 */
export interface WorkspaceSelection {
  team: string | null;
  season: string | null;
  game: string | null;
  unit: Unit | null;
}

export const EMPTY_SELECTION: WorkspaceSelection = { team: null, season: null, game: null, unit: null };
const STORAGE_KEY = 'footballos.workspace.context.v1';
const UNITS: Unit[] = ['offense', 'defense', 'special_teams'];

export function parseUnit(raw: string | null | undefined): Unit | null {
  return raw && (UNITS as string[]).includes(raw) ? (raw as Unit) : null;
}

function readPersisted(): WorkspaceSelection {
  if (typeof window === 'undefined') return EMPTY_SELECTION;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SELECTION;
    const parsed = JSON.parse(raw) as Partial<WorkspaceSelection>;
    return {
      team: typeof parsed.team === 'string' ? parsed.team : null,
      season: typeof parsed.season === 'string' ? parsed.season : null,
      game: typeof parsed.game === 'string' ? parsed.game : null,
      unit: parseUnit(parsed.unit),
    };
  } catch {
    return EMPTY_SELECTION;
  }
}

let current: WorkspaceSelection = readPersisted();
const listeners = new Set<() => void>();

export const workspaceStore = {
  get(): WorkspaceSelection {
    return current;
  },
  set(next: WorkspaceSelection) {
    if (next.team === current.team && next.season === current.season && next.game === current.game && next.unit === current.unit) return;
    current = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* persistence is a convenience only */
    }
    listeners.forEach((l) => l());
  },
  reset() {
    current = EMPTY_SELECTION;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useWorkspaceSelection(): WorkspaceSelection {
  return useSyncExternalStore(workspaceStore.subscribe, workspaceStore.get, workspaceStore.get);
}

/** Query string for a selection; omits unset keys. */
export function selectionQuery(selection: WorkspaceSelection): string {
  const params = new URLSearchParams();
  if (selection.team) params.set('team', selection.team);
  if (selection.season) params.set('season', selection.season);
  if (selection.game) params.set('game', selection.game);
  if (selection.unit) params.set('unit', selection.unit);
  const s = params.toString();
  return s ? `?${s}` : '';
}
