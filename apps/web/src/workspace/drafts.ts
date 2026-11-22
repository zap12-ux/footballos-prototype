import { useCallback, useSyncExternalStore } from 'react';

/**
 * Unsaved coach input (iteration 1, mechanism 1: HC-01, OC-10, PC-03, PC-05).
 *
 * A coach's typed-but-unsaved work survives ordinary navigation inside the workspace:
 * plan section edits and the text still sitting in a section's Add field, a pending label
 * correction (value and reason) per play and label, and an unposted plan comment with the
 * section it was aimed at. Drafts live in memory and are mirrored to `sessionStorage` so a
 * refresh keeps them too; they are cleared by the save that commits them, by an explicit
 * Discard, or by sign-out after a confirmation that names what will be lost.
 *
 * The map is replaced immutably on every write so `useSyncExternalStore` snapshots stay
 * referentially stable between writes.
 */
export type DraftMap = Readonly<Record<string, unknown>>;

const STORAGE_KEY = 'footballos.drafts.v1';

export const draftKeys = {
  /** Section edits of one plan version (the whole `sections` array as the coach has it). */
  planSections: (teamId: string, versionId: string) => `plan:${teamId}:${versionId}:sections`,
  /** Text typed into one section's Add field but not yet added. */
  planAddField: (teamId: string, versionId: string, sectionKey: string) => `plan:${teamId}:${versionId}:add:${sectionKey}`,
  /** Prefix of every Add-field draft for a version. */
  planAddFieldPrefix: (teamId: string, versionId: string) => `plan:${teamId}:${versionId}:add:`,
  /** An unposted comment on a plan version, with the section it is aimed at. */
  planComment: (teamId: string, versionId: string) => `plan:${teamId}:${versionId}:comment`,
  /** A pending correction (status, value, reason) for one label of one play. */
  labelCorrection: (assetId: string, segmentId: string, labelKey: string) => `label:${assetId}:${segmentId}:${labelKey}`,
};

export interface PlanCommentDraft {
  sectionKey: string;
  body: string;
}

export interface LabelCorrectionDraft {
  status: 'accepted' | 'corrected' | 'unknown' | 'rejected';
  value: string;
  reason: string;
}

function readPersisted(): DraftMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as DraftMap) : {};
  } catch {
    return {};
  }
}

let drafts: DraftMap = readPersisted();
const listeners = new Set<() => void>();

function commit(next: DraftMap) {
  drafts = next;
  try {
    if (Object.keys(next).length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: drafts live in memory for this page */
  }
  listeners.forEach((l) => l());
}

export const draftStore = {
  all(): DraftMap {
    return drafts;
  },
  get<T>(key: string): T | undefined {
    return drafts[key] as T | undefined;
  },
  set<T>(key: string, value: T) {
    if (drafts[key] === value) return;
    commit({ ...drafts, [key]: value });
  },
  clear(key: string) {
    if (!(key in drafts)) return;
    const { [key]: _removed, ...rest } = drafts;
    commit(rest);
  },
  /** Remove every draft whose key starts with `prefix`. */
  clearPrefix(prefix: string) {
    const kept = Object.fromEntries(Object.entries(drafts).filter(([k]) => !k.startsWith(prefix)));
    if (Object.keys(kept).length !== Object.keys(drafts).length) commit(kept);
  },
  keys(prefix = ''): string[] {
    return Object.keys(drafts).filter((k) => k.startsWith(prefix));
  },
  reset() {
    if (Object.keys(drafts).length === 0) return;
    commit({});
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The whole draft map; re-renders on any draft change. */
export function useDrafts(): DraftMap {
  return useSyncExternalStore(draftStore.subscribe, draftStore.all, draftStore.all);
}

/** One draft by key: `[value, set, clear]`. `value` is `undefined` while nothing is pending. */
export function useDraft<T>(key: string): [T | undefined, (next: T) => void, () => void] {
  const all = useDrafts();
  const set = useCallback((next: T) => draftStore.set(key, next), [key]);
  const clear = useCallback(() => draftStore.clear(key), [key]);
  return [all[key] as T | undefined, set, clear];
}

/** Plain-language list of what a destructive navigation (sign-out) would discard. */
export function describeDrafts(map: DraftMap = drafts): string[] {
  const keys = Object.keys(map);
  const out: string[] = [];
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));
  const sections = keys.filter((k) => k.startsWith('plan:') && k.endsWith(':sections')).length;
  if (sections) out.push(plural(sections, 'unsaved plan section edits', 'unsaved section edits on {n} plan versions'));
  const adds = keys.filter((k) => k.startsWith('plan:') && k.includes(':add:') && typeof map[k] === 'string' && (map[k] as string).trim() !== '').length;
  if (adds) out.push(plural(adds, 'text typed into a plan Add field', 'text typed into {n} plan Add fields'));
  const comments = keys.filter((k) => k.startsWith('plan:') && k.endsWith(':comment') && typeof (map[k] as PlanCommentDraft | undefined)?.body === 'string' && (map[k] as PlanCommentDraft).body.trim() !== '').length;
  if (comments) out.push(plural(comments, 'an unposted plan comment', '{n} unposted plan comments'));
  const labels = keys.filter((k) => k.startsWith('label:')).length;
  if (labels) out.push(plural(labels, 'a pending label correction', '{n} pending label corrections'));
  return out;
}
