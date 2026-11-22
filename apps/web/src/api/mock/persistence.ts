/**
 * Mock-mode persistence (iteration 1, mechanism 4: OC-01, PC-04).
 *
 * The demo workspace's mutations (approved plans, comments, label corrections, accepted
 * plays, uploads, jobs, invites, schedule edits, snapshots) survive a browser reload for as
 * long as `localStorage` keeps them. The envelope carries a schema version and a fingerprint
 * of the seed: a change to either discards stale state so the demo never shows records whose
 * shape the current code does not expect. "Reset demo data" on `/app/settings` clears it.
 */

export const MOCK_STORE_KEY = 'footballos.mock.v1';
/** Bump when the stored shape changes in a way the fingerprint cannot see (for example a new store field). */
export const MOCK_SCHEMA_VERSION = 1;

export interface MockStoreEnvelope<T> {
  schemaVersion: number;
  seedFingerprint: string;
  savedAt: string;
  state: T;
}

/** FNV-1a over a string; cheap, stable across sessions, good enough to notice a seed change. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The stored state when it matches the current schema and seed; otherwise null (and the stale entry is removed). */
export function readMockStore<T>(seedFingerprint: string): MockStoreEnvelope<T> | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(MOCK_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MockStoreEnvelope<T>> | null;
    if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== MOCK_SCHEMA_VERSION || parsed.seedFingerprint !== seedFingerprint || !parsed.state || typeof parsed.state !== 'object') {
      s.removeItem(MOCK_STORE_KEY);
      return null;
    }
    return parsed as MockStoreEnvelope<T>;
  } catch {
    try {
      s.removeItem(MOCK_STORE_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** Writes an envelope around `stateJson` (already serialized, so the caller can compare it with the last write). */
export function writeMockStore(stateJson: string, seedFingerprint: string): void {
  const s = storage();
  if (!s) return;
  const head = JSON.stringify({ schemaVersion: MOCK_SCHEMA_VERSION, seedFingerprint, savedAt: new Date().toISOString() });
  try {
    s.setItem(MOCK_STORE_KEY, `${head.slice(0, -1)},"state":${stateJson}}`);
  } catch {
    /* quota or private mode: the session keeps working in memory */
  }
}

export function clearMockStore(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(MOCK_STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** When the stored state was last written, for the settings screen; null when nothing is stored. */
export function mockStoreSavedAt(): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(MOCK_STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MockStoreEnvelope<unknown>>;
    return typeof parsed.savedAt === 'string' ? parsed.savedAt : null;
  } catch {
    return null;
  }
}
