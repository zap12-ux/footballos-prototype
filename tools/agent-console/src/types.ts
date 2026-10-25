export type RunKind = 'live' | 'fixture';
export type SelfState = 'not_started' | 'working' | 'reviewing' | 'idle' | 'waiting_on_dependency';
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
export type TaskStatus = 'ready' | 'in_progress' | 'ready_for_review' | 'integrated' | 'verified' | 'blocked';
export type QuestionStatus = 'open' | 'answered' | 'superseded' | 'expired' | 'canceled';
export type ResponseState = 'submitted' | 'delivered' | 'acknowledged';
export type EventSource = 'agent' | 'runtime' | 'owner' | 'lead' | 'system';

export const EVENT_TYPES = [
  'run.created',
  'agent.registered',
  'agent.status',
  'agent.log',
  'agent.spawned',
  'agent.completed',
  'agent.failed',
  'agent.resumed',
  'task.created',
  'task.updated',
  'task.result',
  'question.asked',
  'question.superseded',
  'question.expired',
  'response.submitted',
  'response.delivered',
  'response.acknowledged',
  'message.delivered',
  'verification.recorded',
  'lead.note',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const RUNTIME_EVENT_TYPES = [
  'agent.spawned',
  'agent.completed',
  'agent.failed',
  'agent.resumed',
  'message.delivered',
  'lead.note',
] as const;
export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export interface Run {
  id: string;
  projectId: string;
  kind: RunKind;
  label: string;
  fixture: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  runId: string;
  name: string;
  role: string;
  worktree: string | null;
  branch: string | null;
  runtimeAgentId: string | null;
  /** State the agent last reported about itself (§3). `selfReportedState` is the same value. */
  selfState: SelfState;
  selfReportedState: SelfState;
  /** Message of the agent's last status report. */
  lastMessage: string | null;
  /** Terminal state set by runtime events only. */
  runtimeState: 'completed' | 'failed' | null;
  currentTaskId: string | null;
  blockedByTaskId: string | null;
  lastAgentUpdateAt: string | null;
  lastRuntimeUpdateAt: string | null;
  /** Latest of lastAgentUpdateAt / lastRuntimeUpdateAt. */
  lastUpdateAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentView extends Agent {
  /** Derived per §3. */
  execState: ExecState;
  openBlockingQuestionIds: string[];
}

export interface Task {
  id: string;
  runId: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  agentId: string | null;
  dependsOn: string[];
  allowedPaths: string[];
  branch: string | null;
  status: TaskStatus;
  /** Verification used to set integrated/verified. */
  verificationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskView extends Task {
  /** The last report_task_result for this task, if any. */
  result: TaskResult | null;
}

export interface Question {
  id: string;
  projectId: string;
  runId: string;
  agentId: string;
  taskId: string;
  questionVersion: number;
  question: string;
  why: string;
  options: string[] | null;
  recommendation: string | null;
  blocking: boolean;
  status: QuestionStatus;
  supersedesQuestionId: string | null;
  supersededByQuestionId: string | null;
  clientRequestId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Response {
  id: string;
  projectId: string;
  runId: string;
  questionId: string;
  questionVersion: number;
  agentId: string;
  taskId: string;
  text: string | null;
  option: string | null;
  state: ResponseState;
  clientRequestId: string;
  submittedAt: string;
  deliveredAt: string | null;
  deliveredVia: 'agent_poll' | 'lead_continuation' | null;
  /** Same as deliveredVia (UI name). */
  via: 'agent_poll' | 'lead_continuation' | null;
  acknowledgedAt: string | null;
  ackNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResponseView extends Response {
  /** §6: acknowledged AND a later agent.status/agent.log/agent.resumed from that agent. */
  resumedAfterAck: boolean;
}

export interface TaskResult {
  id: string;
  runId: string;
  taskId: string;
  agentId: string;
  status: 'completed' | 'failed';
  summary: string;
  branch: string;
  commit: string | null;
  changedFiles: string[];
  testsRun: { command: string; passed: boolean; summary: string }[];
  limitations: string[];
  followUps: string[];
  clientRequestId: string;
  createdAt: string;
}

export interface Verification {
  id: string;
  runId: string;
  taskId: string;
  kind: 'tests' | 'integration_merge' | 'browser' | 'git' | 'manual';
  command: string | null;
  resultSummary: string;
  passed: boolean;
  evidence: Record<string, unknown>;
  recordedBy: string;
  createdAt: string;
}

export interface ConsoleEvent {
  id: string;
  seq: number;
  runId: string;
  ts: string;
  type: EventType;
  source: EventSource;
  agentId: string | null;
  taskId: string | null;
  questionId: string | null;
  responseId: string | null;
  payload: Record<string, unknown>;
}
