import type { Agent, ExecState, Question, QuestionResponse, StateSnapshot, Task, TaskStatus } from '../types';
import { DEFAULT_PLANNED_ROLES, DEFAULT_STALE_AFTER_MIN } from '../types';
import { isStale } from './time';

export const EXEC_LABEL: Record<ExecState, string> = {
  not_started: 'Not started',
  working: 'Working',
  waiting_for_you: 'Waiting for you',
  waiting_on_dependency: 'Waiting on dependency',
  reviewing: 'Reviewing',
  idle: 'Idle',
  completed: 'Completed',
  failed: 'Failed',
  disconnected: 'Disconnected',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  ready: 'ready',
  in_progress: 'in progress',
  ready_for_review: 'ready for review',
  integrated: 'integrated',
  verified: 'verified',
  blocked: 'blocked',
};

export const RESPONSE_STATE_LABEL = { submitted: 'Submitted', delivered: 'Delivered', acknowledged: 'Acknowledged' } as const;

export interface Blocker {
  taskId: string;
  title: string | null;
  reason: 'blockedByTaskId' | 'dependsOn';
  ownerAgentId: string | null;
}

export interface AgentView {
  agent: Agent;
  /** `instance #n` suffix when several agents share a role. */
  instanceLabel: string | null;
  displayName: string;
  isLead: boolean;
  execState: ExecState;
  execLabel: string;
  currentTask: Task | null;
  tasks: Task[];
  openQuestions: Question[];
  blockingQuestions: Question[];
  blockers: Blocker[];
  lastUpdateAt: string | null;
  lastMessage: string | null;
  stale: boolean;
}

export function staleAfterMin(snapshot: StateSnapshot | null): number {
  const v = snapshot?.staleAfterMin;
  return typeof v === 'number' && v > 0 ? v : DEFAULT_STALE_AFTER_MIN;
}

export function plannedRoles(snapshot: StateSnapshot | null): string[] {
  const v = snapshot?.plannedRoles;
  return Array.isArray(v) && v.length > 0 ? v.filter((r): r is string => typeof r === 'string') : [...DEFAULT_PLANNED_ROLES];
}

export function isLeadRole(role: string): boolean {
  return /\blead\b|integrator/i.test(role);
}

const TERMINAL_TASK: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['integrated', 'verified']);

function pickCurrentTask(tasks: Task[]): Task | null {
  if (tasks.length === 0) return null;
  const order: TaskStatus[] = ['in_progress', 'blocked', 'ready_for_review', 'ready', 'integrated', 'verified'];
  const sorted = [...tasks].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  return sorted[0];
}

export function buildAgentViews(snapshot: StateSnapshot, nowIso: string): AgentView[] {
  const limit = staleAfterMin(snapshot);
  const byRole = new Map<string, Agent[]>();
  const sorted = [...snapshot.agents].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
  for (const a of sorted) {
    const list = byRole.get(a.role) ?? [];
    list.push(a);
    byRole.set(a.role, list);
  }
  const taskById = new Map(snapshot.tasks.map((t) => [t.id, t]));
  return sorted.map((agent) => {
    const siblings = byRole.get(agent.role) ?? [agent];
    const idx = siblings.indexOf(agent);
    const instanceLabel = siblings.length > 1 ? `instance #${idx + 1}` : null;
    const tasks = snapshot.tasks.filter((t) => t.agentId === agent.id);
    const currentTask = pickCurrentTask(tasks);
    const questions = snapshot.questions.filter((q) => q.agentId === agent.id);
    const openQuestions = questions.filter((q) => q.status === 'open');
    const blockingQuestions = openQuestions.filter((q) => q.blocking);

    const blockers: Blocker[] = [];
    if (agent.blockedByTaskId) {
      const t = taskById.get(agent.blockedByTaskId);
      blockers.push({ taskId: agent.blockedByTaskId, title: t?.title ?? null, reason: 'blockedByTaskId', ownerAgentId: t?.agentId ?? null });
    }
    for (const t of tasks) {
      if (TERMINAL_TASK.has(t.status)) continue;
      for (const dep of t.dependsOn ?? []) {
        const d = taskById.get(dep);
        const unmet = !d || !TERMINAL_TASK.has(d.status);
        if (unmet && !blockers.some((b) => b.taskId === dep)) {
          blockers.push({ taskId: dep, title: d?.title ?? null, reason: 'dependsOn', ownerAgentId: d?.agentId ?? null });
        }
      }
    }

    const lastUpdateAt = agent.lastUpdateAt ?? agent.updatedAt ?? null;
    const base: ExecState = agent.execState ?? 'not_started';
    let execState: ExecState = base;
    if (base !== 'completed' && base !== 'failed') {
      if (blockingQuestions.length > 0) execState = 'waiting_for_you';
      else if (
        (base === 'working' || base === 'reviewing' || base === 'waiting_on_dependency') &&
        isStale(lastUpdateAt ?? agent.createdAt, nowIso, limit)
      )
        execState = 'disconnected';
    }
    return {
      agent,
      instanceLabel,
      displayName: instanceLabel ? `${agent.name} (${instanceLabel})` : agent.name,
      isLead: isLeadRole(agent.role),
      execState,
      execLabel: EXEC_LABEL[execState],
      currentTask,
      tasks,
      openQuestions,
      blockingQuestions,
      blockers,
      lastUpdateAt,
      lastMessage: agent.lastMessage ?? null,
      stale: isStale(lastUpdateAt, nowIso, limit),
    };
  });
}

/** Planned roles for which no agent is registered yet. */
export function missingRoles(snapshot: StateSnapshot): string[] {
  const have = new Set(snapshot.agents.map((a) => a.role.trim().toLowerCase()));
  return plannedRoles(snapshot).filter((r) => !have.has(r.trim().toLowerCase()));
}

export interface QueueItem {
  question: Question;
  agent: Agent | null;
  task: Task | null;
}

/** Needs-your-input queue: open questions, blocking first, oldest first within a group. */
export function buildQueue(snapshot: StateSnapshot): QueueItem[] {
  const agents = new Map(snapshot.agents.map((a) => [a.id, a]));
  const tasks = new Map(snapshot.tasks.map((t) => [t.id, t]));
  return snapshot.questions
    .filter((q) => q.status === 'open')
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.createdAt.localeCompare(b.createdAt))
    .map((q) => ({ question: q, agent: agents.get(q.agentId) ?? null, task: tasks.get(q.taskId) ?? null }));
}

export function responsesFor(snapshot: StateSnapshot, questionId: string): QuestionResponse[] {
  return snapshot.responses.filter((r) => r.questionId === questionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function responseStateLabel(r: QuestionResponse): string {
  const base = RESPONSE_STATE_LABEL[r.state] ?? r.state;
  return r.state === 'acknowledged' && r.resumedAfterAck ? `${base} · Resumed` : base;
}
