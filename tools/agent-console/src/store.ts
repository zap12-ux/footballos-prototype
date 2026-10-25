/**
 * Thin typed query layer over SQLite. Rows are snake_case in the DB and mapped to the
 * camelCase API shapes in ./types. No ORM: every query is visible here.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import type {
  Agent,
  ConsoleEvent,
  EventSource,
  EventType,
  Question,
  Response,
  Run,
  Task,
  TaskResult,
  Verification,
} from './types.js';

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const json = <T>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
};

export const DEFAULT_PROJECT_ID = 'footballos';

export function mapRun(r: Row): Run {
  return {
    id: r.id as string,
    projectId: r.project_id as string,
    kind: r.kind as Run['kind'],
    label: r.label as string,
    fixture: r.kind === 'fixture',
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapAgent(r: Row): Agent {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    name: r.name as string,
    role: r.role as string,
    worktree: str(r.worktree),
    branch: str(r.branch),
    runtimeAgentId: str(r.runtime_agent_id),
    selfState: r.self_state as Agent['selfState'],
    runtimeState: (str(r.runtime_state) as Agent['runtimeState']) ?? null,
    currentTaskId: str(r.current_task_id),
    blockedByTaskId: str(r.blocked_by_task_id),
    lastAgentUpdateAt: str(r.last_agent_update_at),
    lastRuntimeUpdateAt: str(r.last_runtime_update_at),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapTask(r: Row): Task {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    title: r.title as string,
    objective: r.objective as string,
    acceptanceCriteria: json<string[]>(r.acceptance_criteria_json, []),
    agentId: str(r.agent_id),
    dependsOn: json<string[]>(r.depends_on_json, []),
    allowedPaths: json<string[]>(r.allowed_paths_json, []),
    branch: str(r.branch),
    status: r.status as Task['status'],
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapQuestion(r: Row, projectId = DEFAULT_PROJECT_ID): Question {
  return {
    id: r.id as string,
    projectId,
    runId: r.run_id as string,
    agentId: r.agent_id as string,
    taskId: r.task_id as string,
    questionVersion: Number(r.version),
    question: r.question as string,
    why: (r.why as string) ?? '',
    options: json<string[] | null>(r.options_json, null),
    recommendation: str(r.recommendation),
    blocking: Number(r.blocking) === 1,
    status: r.status as Question['status'],
    supersedesQuestionId: str(r.supersedes_question_id),
    supersededByQuestionId: str(r.superseded_by_question_id),
    clientRequestId: r.client_request_id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapResponse(r: Row, projectId = DEFAULT_PROJECT_ID): Response {
  return {
    id: r.id as string,
    projectId,
    runId: r.run_id as string,
    questionId: r.question_id as string,
    questionVersion: Number(r.question_version),
    agentId: r.agent_id as string,
    taskId: r.task_id as string,
    text: str(r.text),
    option: str(r.option),
    state: r.state as Response['state'],
    clientRequestId: r.client_request_id as string,
    submittedAt: r.submitted_at as string,
    deliveredAt: str(r.delivered_at),
    deliveredVia: str(r.delivered_via) as Response['deliveredVia'],
    acknowledgedAt: str(r.acknowledged_at),
    ackNote: str(r.ack_note),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapTaskResult(r: Row): TaskResult {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    taskId: r.task_id as string,
    agentId: r.agent_id as string,
    status: r.status as TaskResult['status'],
    summary: r.summary as string,
    branch: r.branch as string,
    commit: str(r.commit_sha),
    changedFiles: json<string[]>(r.changed_files_json, []),
    testsRun: json<TaskResult['testsRun']>(r.tests_run_json, []),
    limitations: json<string[]>(r.limitations_json, []),
    followUps: json<string[]>(r.follow_ups_json, []),
    clientRequestId: r.client_request_id as string,
    createdAt: r.created_at as string,
  };
}

export function mapVerification(r: Row): Verification {
  return {
    id: r.id as string,
    runId: r.run_id as string,
    taskId: r.task_id as string,
    kind: r.kind as Verification['kind'],
    command: str(r.command),
    resultSummary: r.result_summary as string,
    passed: Number(r.passed) === 1,
    evidence: json<Record<string, unknown>>(r.evidence_json, {}),
    createdAt: r.created_at as string,
  };
}

export function mapEvent(r: Row): ConsoleEvent {
  return {
    id: r.id as string,
    seq: Number(r.seq),
    runId: r.run_id as string,
    ts: r.ts as string,
    type: r.type as EventType,
    source: r.source as EventSource,
    agentId: str(r.agent_id),
    taskId: str(r.task_id),
    questionId: str(r.question_id),
    responseId: str(r.response_id),
    payload: json<Record<string, unknown>>(r.payload_json, {}),
  };
}

export class Store {
  constructor(readonly db: Db) {
    this.ensureProject();
  }

  private ensureProject() {
    this.db
      .prepare('INSERT OR IGNORE INTO projects (id, name, created_at) VALUES (?, ?, ?)')
      .run(DEFAULT_PROJECT_ID, 'FootballOS', nowIso());
  }

  one<T>(sql: string, params: unknown[], map: (r: Row) => T): T | null {
    const row = this.db.prepare(sql).get(...params) as Row | undefined;
    return row ? map(row) : null;
  }

  many<T>(sql: string, params: unknown[], map: (r: Row) => T): T[] {
    return (this.db.prepare(sql).all(...params) as Row[]).map(map);
  }

  // Runs
  getRun(id: string) {
    return this.one('SELECT * FROM runs WHERE id = ?', [id], mapRun);
  }
  listRuns() {
    return this.many('SELECT * FROM runs ORDER BY created_at DESC', [], mapRun);
  }
  latestRun(kind?: 'live' | 'fixture') {
    return kind
      ? this.one('SELECT * FROM runs WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [kind], mapRun)
      : this.one('SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT 1', [], mapRun);
  }

  // Agents
  getAgent(id: string) {
    return this.one('SELECT * FROM agents WHERE id = ?', [id], mapAgent);
  }
  getAgentByTokenHash(hash: string) {
    return this.one('SELECT * FROM agents WHERE token_hash = ?', [hash], mapAgent);
  }
  getAgentByRuntimeId(runtimeAgentId: string) {
    return this.one(
      'SELECT * FROM agents WHERE runtime_agent_id = ? ORDER BY created_at DESC LIMIT 1',
      [runtimeAgentId],
      mapAgent,
    );
  }
  listAgents(runId: string) {
    return this.many('SELECT * FROM agents WHERE run_id = ? ORDER BY created_at', [runId], mapAgent);
  }

  // Tasks
  getTask(id: string) {
    return this.one('SELECT * FROM tasks WHERE id = ?', [id], mapTask);
  }
  listTasks(runId: string) {
    return this.many('SELECT * FROM tasks WHERE run_id = ? ORDER BY created_at', [runId], mapTask);
  }

  // Questions
  getQuestion(id: string) {
    return this.one('SELECT * FROM questions WHERE id = ?', [id], mapQuestion);
  }
  getQuestionByClientRequest(agentId: string, clientRequestId: string) {
    return this.one(
      'SELECT * FROM questions WHERE agent_id = ? AND client_request_id = ?',
      [agentId, clientRequestId],
      mapQuestion,
    );
  }
  listQuestions(runId: string, status?: string) {
    return status
      ? this.many('SELECT * FROM questions WHERE run_id = ? AND status = ? ORDER BY created_at', [runId, status], mapQuestion)
      : this.many('SELECT * FROM questions WHERE run_id = ? ORDER BY created_at', [runId], mapQuestion);
  }
  openBlockingQuestionIdsByAgent(runId: string): Map<string, string[]> {
    const rows = this.db
      .prepare("SELECT id, agent_id FROM questions WHERE run_id = ? AND status = 'open' AND blocking = 1")
      .all(runId) as { id: string; agent_id: string }[];
    const out = new Map<string, string[]>();
    for (const r of rows) out.set(r.agent_id, [...(out.get(r.agent_id) ?? []), r.id]);
    return out;
  }

  // Responses
  getResponse(id: string) {
    return this.one('SELECT * FROM responses WHERE id = ?', [id], mapResponse);
  }
  getResponseByClientRequest(questionId: string, clientRequestId: string) {
    return this.one(
      'SELECT * FROM responses WHERE question_id = ? AND client_request_id = ?',
      [questionId, clientRequestId],
      mapResponse,
    );
  }
  currentResponseForQuestion(questionId: string, version: number) {
    return this.one(
      'SELECT * FROM responses WHERE question_id = ? AND question_version = ? ORDER BY created_at DESC LIMIT 1',
      [questionId, version],
      mapResponse,
    );
  }
  listResponses(runId: string) {
    return this.many('SELECT * FROM responses WHERE run_id = ? ORDER BY created_at', [runId], mapResponse);
  }

  // Results / verifications
  getTaskResultByClientRequest(agentId: string, clientRequestId: string) {
    return this.one(
      'SELECT * FROM task_results WHERE agent_id = ? AND client_request_id = ?',
      [agentId, clientRequestId],
      mapTaskResult,
    );
  }
  listTaskResults(runId: string) {
    return this.many('SELECT * FROM task_results WHERE run_id = ? ORDER BY created_at', [runId], mapTaskResult);
  }
  getVerification(id: string) {
    return this.one('SELECT * FROM verifications WHERE id = ?', [id], mapVerification);
  }
  listVerifications(runId: string) {
    return this.many('SELECT * FROM verifications WHERE run_id = ? ORDER BY created_at', [runId], mapVerification);
  }

  // Events
  getEventByClientId(agentId: string, clientEventId: string) {
    return this.one(
      'SELECT * FROM events WHERE agent_id = ? AND client_event_id = ?',
      [agentId, clientEventId],
      mapEvent,
    );
  }
  eventsAfter(runId: string | null, afterSeq: number, limit = 5000) {
    return runId
      ? this.many('SELECT * FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?', [runId, afterSeq, limit], mapEvent)
      : this.many('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?', [afterSeq, limit], mapEvent);
  }
  lastRuntimeEventAt(runId: string): string | null {
    const row = this.db
      .prepare("SELECT ts FROM events WHERE run_id = ? AND source = 'runtime' ORDER BY seq DESC LIMIT 1")
      .get(runId) as { ts: string } | undefined;
    return row?.ts ?? null;
  }
  /** §6: did the agent send agent.status/agent.log/agent.resumed after the ack event? */
  agentActivityAfterSeq(agentId: string, seq: number): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS hit FROM events WHERE agent_id = ? AND seq > ?
         AND type IN ('agent.status', 'agent.log', 'agent.resumed') LIMIT 1`,
      )
      .get(agentId, seq);
    return !!row;
  }
  ackEventSeq(responseId: string): number | null {
    const row = this.db.prepare('SELECT ack_event_seq FROM responses WHERE id = ?').get(responseId) as
      | { ack_event_seq: number | null }
      | undefined;
    return row?.ack_event_seq ?? null;
  }
}
