import type {
  Agent,
  ConsoleEvent,
  ExecState,
  Question,
  QuestionResponse,
  StateSnapshot,
  Task,
  TaskResult,
  Verification,
} from '../types';
import { EXEC_STATES } from '../types';

export interface ConsoleState {
  snapshot: StateSnapshot | null;
  /** Ordered activity history (by seq), bounded. */
  events: ConsoleEvent[];
  /** Highest seq applied to entity state (not just history). */
  appliedSeq: number;
  /** seq the snapshot is known to include, when the server provides `lastSeq`. */
  snapshotSeq: number | null;
  /** Server clock reference for relative times. */
  serverTimeAtSync: string | null;
  localAtSyncMs: number;
}

export const MAX_EVENTS = 5000;

export function initialState(): ConsoleState {
  return { snapshot: null, events: [], appliedSeq: 0, snapshotSeq: null, serverTimeAtSync: null, localAtSyncMs: Date.now() };
}

export function loadSnapshot(state: ConsoleState, snapshot: StateSnapshot, nowMs = Date.now()): ConsoleState {
  const sameRun = state.snapshot?.run?.id === snapshot.run?.id;
  return {
    snapshot: {
      ...snapshot,
      agents: snapshot.agents ?? [],
      tasks: snapshot.tasks ?? [],
      questions: snapshot.questions ?? [],
      responses: snapshot.responses ?? [],
      verifications: snapshot.verifications ?? [],
      taskResults: snapshot.taskResults ?? collectResults(snapshot.tasks ?? []),
    },
    events: sameRun ? state.events : [],
    appliedSeq: sameRun ? state.appliedSeq : 0,
    snapshotSeq: typeof snapshot.lastSeq === 'number' ? snapshot.lastSeq : null,
    serverTimeAtSync: snapshot.serverTime ?? null,
    localAtSyncMs: nowMs,
  };
}

function collectResults(tasks: Task[]): TaskResult[] {
  return tasks.flatMap((t) => (t.result ? [{ ...t.result, taskId: t.result.taskId ?? t.id }] : []));
}

export function touchHeartbeat(state: ConsoleState, serverTimeIso: string, nowMs = Date.now()): ConsoleState {
  return { ...state, serverTimeAtSync: serverTimeIso, localAtSyncMs: nowMs };
}

/** Payloads may wrap the entity (`{ task: {...} }`) or be the entity itself; accept both. */
function entity<T extends { id: string }>(payload: Record<string, unknown>, key: string): Partial<T> | null {
  const wrapped = payload[key];
  if (wrapped && typeof wrapped === 'object') return wrapped as Partial<T>;
  if (typeof payload.id === 'string') return payload as unknown as Partial<T>;
  return null;
}

function newer(eventTs: string, entityUpdatedAt: string | undefined | null): boolean {
  if (!entityUpdatedAt) return true;
  const a = Date.parse(eventTs);
  const b = Date.parse(entityUpdatedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return a >= b;
}

function upsert<T extends { id: string; updatedAt?: string }>(list: T[], patch: Partial<T> & { id: string }, ts: string, force: boolean): T[] {
  const i = list.findIndex((x) => x.id === patch.id);
  if (i === -1) return [...list, { ...(patch as T), updatedAt: patch.updatedAt ?? ts }];
  const current = list[i];
  if (!force && !newer(ts, current.updatedAt)) return list;
  const next = [...list];
  next[i] = { ...current, ...patch, updatedAt: patch.updatedAt ?? ts };
  return next;
}

const RUNTIME_TYPES = new Set(['agent.spawned', 'agent.completed', 'agent.failed', 'agent.resumed', 'message.delivered', 'lead.note']);
const SELF_REPORTABLE: ReadonlySet<string> = new Set<ExecState>(['working', 'reviewing', 'idle', 'waiting_on_dependency']);

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/**
 * Apply one event. History is always recorded; entity state is patched only when the event
 * is newer than the snapshot (by `lastSeq` when known, by timestamps otherwise).
 */
export function applyEvent(state: ConsoleState, ev: ConsoleEvent): ConsoleState {
  if (state.events.some((e) => e.id === ev.id)) return state;
  let events = insertBySeq(state.events, ev);
  if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
  const snap = state.snapshot;
  if (!snap || (snap.run && ev.runId && ev.runId !== snap.run.id)) return { ...state, events };
  const historyOnly = state.snapshotSeq !== null && ev.seq <= state.snapshotSeq;
  if (historyOnly) return { ...state, events, appliedSeq: Math.max(state.appliedSeq, ev.seq) };
  const force = state.snapshotSeq !== null; // seq ordering proves the event is newer than the snapshot
  const next = reduceEntities(snap, ev, force);
  return { ...state, events, appliedSeq: Math.max(state.appliedSeq, ev.seq), snapshot: next };
}

function insertBySeq(list: ConsoleEvent[], ev: ConsoleEvent): ConsoleEvent[] {
  if (list.length === 0 || list[list.length - 1].seq <= ev.seq) return [...list, ev];
  const i = list.findIndex((e) => e.seq > ev.seq);
  return [...list.slice(0, i), ev, ...list.slice(i)];
}

function reduceEntities(snap: StateSnapshot, ev: ConsoleEvent, force: boolean): StateSnapshot {
  const p = ev.payload ?? {};
  let s: StateSnapshot = snap;
  if (RUNTIME_TYPES.has(ev.type) || ev.source === 'runtime') {
    if (!s.lastRuntimeEventAt || newer(ev.ts, s.lastRuntimeEventAt)) s = { ...s, lastRuntimeEventAt: ev.ts };
  }
  const agentTouch = (patch: Partial<Agent>, message?: string) => {
    if (!ev.agentId) return;
    const current = s.agents.find((a) => a.id === ev.agentId);
    if (!current) return;
    if (!force && current.lastUpdateAt && !newer(ev.ts, current.lastUpdateAt)) return;
    s = {
      ...s,
      agents: s.agents.map((a) =>
        a.id === ev.agentId ? { ...a, ...patch, lastUpdateAt: ev.ts, lastMessage: message ?? a.lastMessage ?? null, updatedAt: ev.ts } : a,
      ),
    };
  };
  const markResumed = () => {
    if (!ev.agentId) return;
    s = {
      ...s,
      responses: s.responses.map((r) =>
        r.agentId === ev.agentId && r.state === 'acknowledged' && !r.resumedAfterAck && newer(ev.ts, r.acknowledgedAt ?? r.updatedAt)
          ? { ...r, resumedAfterAck: true }
          : r,
      ),
    };
  };

  switch (ev.type) {
    case 'run.created':
      break;
    case 'agent.registered': {
      const a = entity<Agent>(p, 'agent');
      if (a?.id) s = { ...s, agents: upsert(s.agents, { ...(a as Agent), id: a.id, createdAt: a.createdAt ?? ev.ts }, ev.ts, force) };
      break;
    }
    case 'agent.status': {
      const st = pickString(p, 'state', 'execState');
      const patch: Partial<Agent> = {};
      if (st && SELF_REPORTABLE.has(st) && (EXEC_STATES as readonly string[]).includes(st)) patch.execState = st as ExecState;
      agentTouch(patch, pickString(p, 'message'));
      markResumed();
      break;
    }
    case 'agent.log':
      agentTouch({}, pickString(p, 'message'));
      markResumed();
      break;
    case 'agent.spawned': {
      const patch: Partial<Agent> = {};
      const rid = pickString(p, 'runtimeAgentId');
      if (rid) patch.runtimeAgentId = rid;
      agentTouch(patch, pickString(p, 'message', 'note') ?? 'Agent spawned (runtime)');
      break;
    }
    case 'agent.completed':
      agentTouch({ execState: 'completed' }, pickString(p, 'message', 'summary', 'note') ?? 'Agent completed (runtime)');
      break;
    case 'agent.failed':
      agentTouch({ execState: 'failed' }, pickString(p, 'message', 'error', 'note') ?? 'Agent failed (runtime)');
      break;
    case 'agent.resumed':
      agentTouch({}, pickString(p, 'message', 'note') ?? 'Agent resumed (runtime)');
      markResumed();
      break;
    case 'task.created':
    case 'task.updated': {
      const t = entity<Task>(p, 'task');
      if (t?.id) s = { ...s, tasks: upsert(s.tasks, { ...(t as Task), id: t.id }, ev.ts, force) };
      break;
    }
    case 'task.result': {
      const r = (p.result && typeof p.result === 'object' ? p.result : p) as Partial<TaskResult>;
      const taskId = ev.taskId ?? r.taskId;
      if (taskId && r.status) {
        const result: TaskResult = {
          status: r.status,
          summary: r.summary ?? '',
          branch: r.branch,
          commit: r.commit,
          changedFiles: r.changedFiles ?? [],
          testsRun: r.testsRun ?? [],
          limitations: r.limitations ?? [],
          followUps: r.followUps ?? [],
          id: r.id,
          taskId,
          agentId: r.agentId ?? ev.agentId ?? undefined,
          createdAt: r.createdAt ?? ev.ts,
        };
        s = {
          ...s,
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, result, status: t.status === 'integrated' || t.status === 'verified' ? t.status : 'ready_for_review', updatedAt: ev.ts } : t)),
          taskResults: [...(s.taskResults ?? []).filter((x) => !(x.id && x.id === result.id)), result],
        };
      }
      break;
    }
    case 'question.asked': {
      const q = entity<Question>(p, 'question');
      if (q?.id) {
        s = { ...s, questions: upsert(s.questions, { ...(q as Question), id: q.id, status: q.status ?? 'open' }, ev.ts, force) };
        const old = q.supersedesQuestionId;
        if (old) s = { ...s, questions: s.questions.map((x) => (x.id === old && x.status === 'open' ? { ...x, status: 'superseded', updatedAt: ev.ts } : x)) };
      }
      break;
    }
    case 'question.superseded':
    case 'question.expired': {
      const id = ev.questionId ?? (entity<Question>(p, 'question')?.id as string | undefined);
      const status = ev.type === 'question.superseded' ? 'superseded' : 'expired';
      if (id) s = { ...s, questions: s.questions.map((x) => (x.id === id ? { ...x, status, updatedAt: ev.ts } : x)) };
      break;
    }
    case 'response.submitted': {
      const r = entity<QuestionResponse>(p, 'response');
      if (r?.id) {
        s = { ...s, responses: upsert(s.responses, { ...(r as QuestionResponse), id: r.id, state: r.state ?? 'submitted', createdAt: r.createdAt ?? ev.ts }, ev.ts, force) };
        const qid = r.questionId ?? ev.questionId;
        if (qid) s = { ...s, questions: s.questions.map((x) => (x.id === qid && x.status === 'open' ? { ...x, status: 'answered', updatedAt: ev.ts } : x)) };
      }
      break;
    }
    case 'response.delivered':
    case 'response.acknowledged':
    case 'message.delivered': {
      const r = entity<QuestionResponse>(p, 'response');
      const id = ev.responseId ?? r?.id;
      if (!id) break;
      const toState = ev.type === 'response.acknowledged' ? 'acknowledged' : 'delivered';
      s = {
        ...s,
        responses: s.responses.map((x) => {
          if (x.id !== id) return x;
          if (!force && !newer(ev.ts, x.updatedAt)) return x;
          const rank = { submitted: 0, delivered: 1, acknowledged: 2 } as const;
          const state = rank[toState] >= rank[x.state] ? toState : x.state;
          return {
            ...x,
            ...(r ?? {}),
            id,
            state,
            deliveredAt: toState === 'delivered' ? (r?.deliveredAt ?? pickString(p, 'deliveredAt') ?? ev.ts) : x.deliveredAt,
            via: toState === 'delivered' ? (r?.via ?? pickString(p, 'via') ?? (ev.type === 'message.delivered' ? 'lead_continuation' : 'agent_poll')) : x.via,
            acknowledgedAt: toState === 'acknowledged' ? (r?.acknowledgedAt ?? ev.ts) : x.acknowledgedAt,
            updatedAt: ev.ts,
          };
        }),
      };
      break;
    }
    case 'verification.recorded': {
      const v = entity<Verification>(p, 'verification');
      if (v?.id) s = { ...s, verifications: upsert(s.verifications as Array<Verification & { updatedAt?: string }>, { ...(v as Verification), id: v.id, createdAt: v.createdAt ?? ev.ts }, ev.ts, force) };
      break;
    }
    case 'lead.note':
    default:
      break;
  }
  return s;
}

export function applyEvents(state: ConsoleState, events: ConsoleEvent[]): ConsoleState {
  return events.reduce(applyEvent, state);
}
