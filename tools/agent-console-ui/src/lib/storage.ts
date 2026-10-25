/**
 * Per-browser conveniences kept in localStorage: question drafts and manual node positions.
 * Nothing authoritative lives here; everything else is restored from the server.
 */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export interface QuestionDraft {
  option: string | null;
  text: string;
  updatedAt: number;
}

const draftKey = (questionId: string) => `agentConsole.draft.${questionId}`;

export function loadDraft(questionId: string): QuestionDraft | null {
  return read<QuestionDraft | null>(draftKey(questionId), null);
}

export function saveDraft(questionId: string, draft: Omit<QuestionDraft, 'updatedAt'>): void {
  if (!draft.text && !draft.option) {
    remove(draftKey(questionId));
    return;
  }
  write(draftKey(questionId), { ...draft, updatedAt: Date.now() });
}

export function clearDraft(questionId: string): void {
  remove(draftKey(questionId));
}

export type NodePositions = Record<string, { x: number; y: number }>;

const positionsKey = (runId: string) => `agentConsole.positions.${runId}`;

export function loadPositions(runId: string): NodePositions {
  return read<NodePositions>(positionsKey(runId), {});
}

export function savePositions(runId: string, positions: NodePositions): void {
  write(positionsKey(runId), positions);
}

const runKey = 'agentConsole.selectedRun';
export function loadSelectedRun(): string | null {
  return read<string | null>(runKey, null);
}
export function saveSelectedRun(runId: string | null): void {
  if (runId) write(runKey, runId);
  else remove(runKey);
}
