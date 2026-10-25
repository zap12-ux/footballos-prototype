/**
 * Types for the Agent Build Console contract v1 (tools/agent-console/CONTRACT.md).
 * Fields the contract does not spell out are optional and documented as assumptions
 * in the package README so the server engineer can reconcile them.
 */

export type RunKind = 'live' | 'fixture';

export interface Run {
  id: string;
  projectId?: string;
  kind: RunKind;
  label: string;
  createdAt: string;
  updatedAt?: string;
}

/** §3 agent execution states (exactly nine). */
export type ExecState =
  | 'not_started'
  | 'working'
  | 'waiting_for_you'
  | 'waiting_on_dependency'
  | 'reviewing'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'disconnected';

export const EXEC_STATES: readonly ExecState[] = [
  'not_started',
  'working',
  'waiting_for_you',
  'waiting_on_dependency',
  'reviewing',
  'idle',
  'completed',
  'failed',
  'disconnected',
];

/** §3 task statuses, kept separate from execution state. */
export type TaskStatus = 'ready' | 'in_progress' | 'ready_for_review' | 'integrated' | 'verified' | 'blocked';

export interface Agent {
  id: string;
  runId: string;
  name: string;
  role: string;
  worktree?: string | null;
  branch?: string | null;
  runtimeAgentId?: string | null;
  blockedByTaskId?: string | null;
  execState?: ExecState;
  /** Assumed: server may precompute the last meaningful update. Derived from events otherwise. */
  lastUpdateAt?: string | null;
  lastMessage?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface TestRun {
  command: string;
  passed: boolean;
  summary: string;
}

/** Body of report_task_result (§4.2) as stored on the task or in task.result events. */
export interface TaskResult {
  id?: string;
  taskId?: string;
  agentId?: string;
  status: 'completed' | 'failed';
  summary: string;
  branch?: string;
  commit?: string;
  changedFiles: string[];
  testsRun: TestRun[];
  limitations: string[];
  followUps: string[];
  createdAt?: string;
}

export interface Task {
  id: string;
  runId: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  agentId?: string | null;
  dependsOn: string[];
  allowedPaths?: string[];
  branch?: string | null;
  status: TaskStatus;
  /** Assumed: latest report_task_result attached to the task. */
  result?: TaskResult | null;
  verificationId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export type QuestionStatus = 'open' | 'answered' | 'superseded' | 'expired' | 'canceled';

export interface Question {
  id: string;
  projectId?: string;
  runId: string;
  agentId: string;
  taskId: string;
  questionVersion: number;
  question: string;
  why: string;
  options?: string[] | null;
  recommendation?: string | null;
  blocking: boolean;
  status: QuestionStatus;
  supersedesQuestionId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ResponseState = 'submitted' | 'delivered' | 'acknowledged';

export interface QuestionResponse {
  id: string;
  projectId?: string;
  runId: string;
  agentId: string;
  taskId: string;
  questionId: string;
  questionVersion: number;
  clientRequestId?: string;
  text?: string | null;
  option?: string | null;
  state: ResponseState;
  deliveredAt?: string | null;
  via?: 'agent_poll' | 'lead_continuation' | string | null;
  acknowledgedAt?: string | null;
  /** §6: true only after an agent.status/agent.log/agent.resumed following acknowledgement. */
  resumedAfterAck?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VerificationKind = 'tests' | 'integration_merge' | 'browser' | 'git' | 'manual';

export interface Verification {
  id: string;
  runId?: string;
  taskId: string;
  kind: VerificationKind;
  command?: string | null;
  resultSummary: string;
  passed: boolean;
  evidence: Record<string, unknown>;
  /** Assumed: who recorded it (lead / QA). */
  recordedBy?: string | null;
  createdAt: string;
}

export interface StateSnapshot {
  run: Run | null;
  agents: Agent[];
  tasks: Task[];
  questions: Question[];
  responses: QuestionResponse[];
  verifications: Verification[];
  lastRuntimeEventAt: string | null;
  serverTime: string;
  /** Optional extras the UI honours when present (see README "contract assumptions"). */
  plannedRoles?: string[];
  staleAfterMin?: number;
  lastSeq?: number;
  taskResults?: TaskResult[];
}

export type EventType =
  | 'run.created'
  | 'agent.registered'
  | 'agent.status'
  | 'agent.log'
  | 'agent.spawned'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.resumed'
  | 'task.created'
  | 'task.updated'
  | 'task.result'
  | 'question.asked'
  | 'question.superseded'
  | 'question.expired'
  | 'response.submitted'
  | 'response.delivered'
  | 'response.acknowledged'
  | 'message.delivered'
  | 'verification.recorded'
  | 'lead.note';

export type EventSource = 'agent' | 'runtime' | 'owner' | 'lead' | 'system';

export interface ConsoleEvent {
  id: string;
  seq: number;
  runId: string;
  ts: string;
  type: EventType | string;
  source: EventSource | string;
  agentId?: string | null;
  taskId?: string | null;
  questionId?: string | null;
  responseId?: string | null;
  payload: Record<string, unknown>;
}

export interface GitInfo {
  branch: string | null;
  ahead: number;
  commits: Array<{ sha: string; subject?: string; message?: string; author?: string; date?: string }>;
  /** Server v1.1 sends `{ status, path }` (git name-status); plain paths are accepted too. */
  changedFiles: Array<string | { status?: string; path: string }>;
  mergedIntoIntegration: boolean;
  exists?: boolean;
  error?: string | null;
}

export interface ApiError {
  error: { code: 'validation_error' | 'unauthorized' | 'not_found' | 'conflict' | 'gone' | 'internal' | string; message?: string; details?: unknown };
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** The seven planned roles used when the server does not provide `plannedRoles`. */
export const DEFAULT_PLANNED_ROLES: readonly string[] = [
  'Lead / Integrator',
  'Product Design / Frontend',
  'Backend / Team Platform',
  'Media / Document Processing',
  'Applied AI / Scouting',
  'QA / Security',
  'Deployment / Reliability',
];

export const DEFAULT_STALE_AFTER_MIN = 20;
