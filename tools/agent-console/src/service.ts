/**
 * All state changes live here. Every mutation runs in one SQLite transaction together with
 * the events it produces; events are published to the in-process bus only after commit, so
 * the stream never carries an event that was not persisted.
 */
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Config } from './config.js';
import { deriveExecState } from './derive.js';
import { ApiError, conflict, gone, notFound, validation } from './errors.js';
import { redact, redactDeep } from './redact.js';
import { Store, newId, nowIso } from './store.js';
import type {
  Agent,
  AgentView,
  ConsoleEvent,
  EventSource,
  EventType,
  Question,
  Response,
  ResponseView,
  Run,
  RuntimeEventType,
  SelfState,
  Task,
  TaskResult,
  TaskStatus,
  Verification,
} from './types.js';

export interface NewEvent {
  runId: string;
  type: EventType;
  source: EventSource;
  agentId?: string | null;
  taskId?: string | null;
  questionId?: string | null;
  responseId?: string | null;
  payload?: Record<string, unknown>;
  clientEventId?: string | null;
}

export interface StateSnapshot {
  run: Run | null;
  agents: AgentView[];
  tasks: Task[];
  questions: Question[];
  responses: ResponseView[];
  taskResults: TaskResult[];
  verifications: Verification[];
  lastRuntimeEventAt: string | null;
  serverTime: string;
  config: { staleAfterMin: number; leadPickupAfterSec: number };
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type PollResult =
  | { status: 200; body: { response: Response; question: Question } }
  | { status: 204 }
  | { status: 410; body: ReturnType<ApiError['toBody']> };

export class Service {
  readonly bus = new EventEmitter();
  private readonly store: Store;

  constructor(
    store: Store,
    readonly config: Pick<Config, 'staleAfterMin' | 'leadPickupAfterSec'>,
  ) {
    this.store = store;
    this.bus.setMaxListeners(1000);
  }

  get db() {
    return this.store.db;
  }

  // ---- transaction + event plumbing -------------------------------------------------

  /** Run `fn` in one transaction; events created via `emit` are published after commit. */
  private tx<T>(fn: (emit: (e: NewEvent) => ConsoleEvent) => T): T {
    const pending: ConsoleEvent[] = [];
    const insert = this.db.prepare(
      `INSERT INTO events (id, run_id, ts, type, source, agent_id, task_id, question_id, response_id, payload_json, client_event_id)
       VALUES (@id, @run_id, @ts, @type, @source, @agent_id, @task_id, @question_id, @response_id, @payload_json, @client_event_id)`,
    );
    const emit = (e: NewEvent): ConsoleEvent => {
      const ev: ConsoleEvent = {
        id: newId(),
        seq: 0,
        runId: e.runId,
        ts: nowIso(),
        type: e.type,
        source: e.source,
        agentId: e.agentId ?? null,
        taskId: e.taskId ?? null,
        questionId: e.questionId ?? null,
        responseId: e.responseId ?? null,
        payload: redactDeep(e.payload ?? {}),
      };
      const info = insert.run({
        id: ev.id,
        run_id: ev.runId,
        ts: ev.ts,
        type: ev.type,
        source: ev.source,
        agent_id: ev.agentId,
        task_id: ev.taskId,
        question_id: ev.questionId,
        response_id: ev.responseId,
        payload_json: JSON.stringify(ev.payload),
        client_event_id: e.clientEventId ?? null,
      });
      ev.seq = Number(info.lastInsertRowid);
      pending.push(ev);
      return ev;
    };
    const result = this.db.transaction(() => fn(emit))();
    for (const ev of pending) this.bus.emit('event', ev);
    return result;
  }

  // ---- runs ---------------------------------------------------------------------------

  createRun(input: { kind: 'live' | 'fixture'; label: string }): Run {
    return this.tx((emit) => {
      const id = newId();
      const ts = nowIso();
      this.db
        .prepare('INSERT INTO runs (id, project_id, kind, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, 'footballos', input.kind, redact(input.label), ts, ts);
      const run = this.store.getRun(id)!;
      emit({ runId: id, type: 'run.created', source: 'lead', payload: { kind: run.kind, label: run.label } });
      return run;
    });
  }

  listRuns() {
    return this.store.listRuns();
  }

  getRun(id: string) {
    return this.store.getRun(id);
  }

  latestLiveRun() {
    return this.store.latestRun('live');
  }

  /** Resolve the run for owner reads: explicit id, else latest live, else latest of any kind. */
  resolveRun(runId?: string | null): Run | null {
    if (runId) {
      const run = this.store.getRun(runId);
      if (!run) throw notFound('run');
      return run;
    }
    return this.store.latestRun('live') ?? this.store.latestRun();
  }

  // ---- agents -------------------------------------------------------------------------

  registerAgent(input: {
    runId: string;
    name: string;
    role: string;
    worktree?: string | null;
    branch?: string | null;
    runtimeAgentId?: string | null;
  }): { agent: Agent; agentToken: string } {
    if (!this.store.getRun(input.runId)) throw notFound('run');
    const token = randomBytes(32).toString('hex');
    return this.tx((emit) => {
      const id = newId();
      const ts = nowIso();
      this.db
        .prepare(
          `INSERT INTO agents (id, run_id, name, role, worktree, branch, runtime_agent_id, token_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.runId,
          redact(input.name),
          redact(input.role),
          input.worktree ?? null,
          input.branch ?? null,
          input.runtimeAgentId ?? null,
          sha256(token),
          ts,
          ts,
        );
      const agent = this.store.getAgent(id)!;
      emit({
        runId: input.runId,
        type: 'agent.registered',
        source: 'lead',
        agentId: id,
        payload: { name: agent.name, role: agent.role, branch: agent.branch, worktree: agent.worktree },
      });
      return { agent, agentToken: token };
    });
  }

  authenticateAgent(token: string): Agent | null {
    return this.store.getAgentByTokenHash(sha256(token));
  }

  patchAgent(
    agentId: string,
    patch: { runtimeAgentId?: string | null; worktree?: string | null; branch?: string | null; blockedByTaskId?: string | null },
  ): Agent {
    const agent = this.store.getAgent(agentId);
    if (!agent) throw notFound('agent');
    return this.tx((emit) => {
      const ts = nowIso();
      this.db
        .prepare(
          `UPDATE agents SET runtime_agent_id = ?, worktree = ?, branch = ?, blocked_by_task_id = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          patch.runtimeAgentId !== undefined ? patch.runtimeAgentId : agent.runtimeAgentId,
          patch.worktree !== undefined ? patch.worktree : agent.worktree,
          patch.branch !== undefined ? patch.branch : agent.branch,
          patch.blockedByTaskId !== undefined ? patch.blockedByTaskId : agent.blockedByTaskId,
          ts,
          agentId,
        );
      const updated = this.store.getAgent(agentId)!;
      emit({ runId: agent.runId, type: 'lead.note', source: 'lead', agentId, payload: { agentPatched: patch } });
      return updated;
    });
  }

  getAgent(id: string) {
    return this.store.getAgent(id);
  }

  // ---- tasks --------------------------------------------------------------------------

  createTask(input: {
    runId: string;
    id?: string;
    title: string;
    objective: string;
    acceptanceCriteria: string[];
    agentId?: string | null;
    dependsOn: string[];
    allowedPaths: string[];
    branch?: string | null;
  }): Task {
    if (!this.store.getRun(input.runId)) throw notFound('run');
    if (input.agentId) {
      const agent = this.store.getAgent(input.agentId);
      if (!agent || agent.runId !== input.runId) throw validation('agentId does not belong to this run');
    }
    const id = input.id ?? newId();
    if (this.store.getTask(id)) throw conflict('task id already exists', { taskId: id });
    return this.tx((emit) => {
      const ts = nowIso();
      this.db
        .prepare(
          `INSERT INTO tasks (id, run_id, title, objective, acceptance_criteria_json, agent_id, depends_on_json, allowed_paths_json, branch, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
        )
        .run(
          id,
          input.runId,
          redact(input.title),
          redact(input.objective),
          JSON.stringify(input.acceptanceCriteria.map(redact)),
          input.agentId ?? null,
          JSON.stringify(input.dependsOn),
          JSON.stringify(input.allowedPaths),
          input.branch ?? null,
          ts,
          ts,
        );
      const task = this.store.getTask(id)!;
      emit({
        runId: input.runId,
        type: 'task.created',
        source: 'lead',
        taskId: id,
        agentId: task.agentId,
        payload: { title: task.title, status: task.status, agentId: task.agentId },
      });
      return task;
    });
  }

  patchTask(
    taskId: string,
    patch: {
      status?: TaskStatus;
      agentId?: string | null;
      dependsOn?: string[];
      allowedPaths?: string[];
      branch?: string | null;
      title?: string;
      objective?: string;
      acceptanceCriteria?: string[];
      verificationId?: string;
    },
  ): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw notFound('task');
    if (patch.status === 'integrated' || patch.status === 'verified') {
      if (!patch.verificationId) {
        throw validation(`status '${patch.status}' requires a verificationId`, { field: 'verificationId' });
      }
      const v = this.store.getVerification(patch.verificationId);
      if (!v || v.taskId !== taskId) throw validation('verificationId does not reference a verification of this task');
    }
    if (patch.agentId) {
      const agent = this.store.getAgent(patch.agentId);
      if (!agent || agent.runId !== task.runId) throw validation('agentId does not belong to this run');
    }
    return this.tx((emit) => {
      const ts = nowIso();
      const next: Task = {
        ...task,
        status: patch.status ?? task.status,
        agentId: patch.agentId !== undefined ? patch.agentId : task.agentId,
        dependsOn: patch.dependsOn ?? task.dependsOn,
        allowedPaths: patch.allowedPaths ?? task.allowedPaths,
        branch: patch.branch !== undefined ? patch.branch : task.branch,
        title: patch.title !== undefined ? redact(patch.title) : task.title,
        objective: patch.objective !== undefined ? redact(patch.objective) : task.objective,
        acceptanceCriteria: patch.acceptanceCriteria?.map(redact) ?? task.acceptanceCriteria,
      };
      this.db
        .prepare(
          `UPDATE tasks SET status = ?, agent_id = ?, depends_on_json = ?, allowed_paths_json = ?, branch = ?, title = ?, objective = ?, acceptance_criteria_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          next.status,
          next.agentId,
          JSON.stringify(next.dependsOn),
          JSON.stringify(next.allowedPaths),
          next.branch,
          next.title,
          next.objective,
          JSON.stringify(next.acceptanceCriteria),
          ts,
          taskId,
        );
      emit({
        runId: task.runId,
        type: 'task.updated',
        source: 'lead',
        taskId,
        agentId: next.agentId,
        payload: {
          previousStatus: task.status,
          status: next.status,
          changes: Object.keys(patch),
          verificationId: patch.verificationId ?? null,
        },
      });
      if (next.status === 'integrated' || next.status === 'verified') this.expireOpenQuestionsForTask(taskId, emit);
      return this.store.getTask(taskId)!;
    });
  }

  /** Once a task is integrated/verified its open questions can no longer be answered (§4.2 eligibility). */
  private expireOpenQuestionsForTask(taskId: string, emit: (e: NewEvent) => ConsoleEvent) {
    const open = this.db
      .prepare("SELECT * FROM questions WHERE task_id = ? AND status = 'open'")
      .all(taskId) as Record<string, unknown>[];
    for (const row of open) {
      const ts = nowIso();
      this.db.prepare("UPDATE questions SET status = 'expired', updated_at = ? WHERE id = ?").run(ts, row.id);
      emit({
        runId: row.run_id as string,
        type: 'question.expired',
        source: 'system',
        agentId: row.agent_id as string,
        taskId,
        questionId: row.id as string,
        payload: { reason: 'task_closed' },
      });
    }
  }

  // ---- verifications ------------------------------------------------------------------

  createVerification(input: {
    taskId: string;
    kind: Verification['kind'];
    command?: string | null;
    resultSummary: string;
    passed: boolean;
    evidence: Record<string, unknown>;
  }): Verification {
    const task = this.store.getTask(input.taskId);
    if (!task) throw notFound('task');
    return this.tx((emit) => {
      const id = newId();
      const ts = nowIso();
      this.db
        .prepare(
          `INSERT INTO verifications (id, run_id, task_id, kind, command, result_summary, passed, evidence_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          task.runId,
          input.taskId,
          input.kind,
          input.command ? redact(input.command) : null,
          redact(input.resultSummary),
          input.passed ? 1 : 0,
          JSON.stringify(redactDeep(input.evidence)),
          ts,
        );
      const v = this.store.getVerification(id)!;
      emit({
        runId: task.runId,
        type: 'verification.recorded',
        source: 'lead',
        taskId: input.taskId,
        agentId: task.agentId,
        payload: { verificationId: id, kind: v.kind, passed: v.passed, resultSummary: v.resultSummary },
      });
      return v;
    });
  }

  // ---- runtime events (lead-posted) ---------------------------------------------------

  postRuntimeEvent(input: {
    type: RuntimeEventType;
    runId?: string | null;
    agentId?: string | null;
    taskId?: string | null;
    responseId?: string | null;
    details: Record<string, unknown>;
  }): ConsoleEvent {
    let agent = input.agentId ? this.store.getAgent(input.agentId) : null;
    if (input.agentId && !agent) throw notFound('agent');
    // Hook forwarder: map Claude Code's runtime agent id to a registered agent when no agentId is given.
    const hook = input.details.hook as { runtimeAgentId?: unknown } | undefined;
    if (!agent && hook && typeof hook.runtimeAgentId === 'string') {
      agent = this.store.getAgentByRuntimeId(hook.runtimeAgentId);
    }
    const response = input.responseId ? this.store.getResponse(input.responseId) : null;
    if (input.responseId && !response) throw notFound('response');
    const task = input.taskId ? this.store.getTask(input.taskId) : null;
    if (input.taskId && !task) throw notFound('task');

    const needsAgent: RuntimeEventType[] = ['agent.spawned', 'agent.completed', 'agent.failed', 'agent.resumed'];
    if (needsAgent.includes(input.type) && !agent) throw validation(`${input.type} requires agentId`);
    if (input.type === 'message.delivered' && !response) throw validation('message.delivered requires responseId');

    const runId =
      input.runId ?? agent?.runId ?? response?.runId ?? task?.runId ?? this.store.latestRun('live')?.id ?? null;
    if (!runId) throw validation('no run to attach this event to; create a run first or pass runId');
    if (!this.store.getRun(runId)) throw notFound('run');

    return this.tx((emit) => {
      const ts = nowIso();
      if (agent) {
        const runtimeState =
          input.type === 'agent.completed' ? 'completed' : input.type === 'agent.failed' ? 'failed' : null;
        const runtimeAgentId =
          typeof input.details.runtimeAgentId === 'string' ? input.details.runtimeAgentId : agent.runtimeAgentId;
        if (needsAgent.includes(input.type)) {
          this.db
            .prepare(
              `UPDATE agents SET runtime_state = ?, runtime_agent_id = ?, last_runtime_update_at = ?, updated_at = ? WHERE id = ?`,
            )
            .run(runtimeState, runtimeAgentId, ts, ts, agent.id);
        }
      }
      const ev = emit({
        runId,
        type: input.type,
        source: 'runtime',
        agentId: agent?.id ?? response?.agentId ?? null,
        taskId: task?.id ?? response?.taskId ?? null,
        questionId: response?.questionId ?? null,
        responseId: response?.id ?? null,
        payload: { details: input.details },
      });
      if (input.type === 'message.delivered' && response && response.state === 'submitted') {
        this.db
          .prepare(
            `UPDATE responses SET state = 'delivered', delivered_at = ?, delivered_via = 'lead_continuation', updated_at = ? WHERE id = ?`,
          )
          .run(ts, ts, response.id);
        emit({
          runId,
          type: 'response.delivered',
          source: 'runtime',
          agentId: response.agentId,
          taskId: response.taskId,
          questionId: response.questionId,
          responseId: response.id,
          payload: { via: 'lead_continuation' },
        });
      }
      return ev;
    });
  }

  // ---- owner responses ----------------------------------------------------------------

  submitResponse(
    questionId: string,
    input: { clientRequestId: string; questionVersion: number; text?: string | null; option?: string | null },
  ): { response: Response; created: boolean } {
    const question = this.store.getQuestion(questionId);
    if (!question) throw notFound('question');
    const existing = this.store.getResponseByClientRequest(questionId, input.clientRequestId);
    if (existing) return { response: existing, created: false };
    if (question.status !== 'open') {
      throw conflict(`question is ${question.status}, not open`, { status: question.status });
    }
    if (input.questionVersion !== question.questionVersion) {
      throw conflict('questionVersion does not match the current question', {
        expected: question.questionVersion,
        got: input.questionVersion,
      });
    }
    const text = input.text?.trim() ? redact(input.text.trim()) : null;
    const option = input.option?.trim() ? input.option.trim() : null;
    if (!text && !option) throw validation('text or option is required');
    if (option && question.options && !question.options.includes(option)) {
      throw validation('option is not one of the question options', { options: question.options });
    }
    return this.tx((emit) => {
      const id = newId();
      const ts = nowIso();
      this.db
        .prepare(
          `INSERT INTO responses (id, run_id, question_id, question_version, agent_id, task_id, text, option, state, client_request_id, submitted_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
        )
        .run(
          id,
          question.runId,
          questionId,
          question.questionVersion,
          question.agentId,
          question.taskId,
          text,
          option,
          input.clientRequestId,
          ts,
          ts,
          ts,
        );
      this.db.prepare("UPDATE questions SET status = 'answered', updated_at = ? WHERE id = ?").run(ts, questionId);
      this.db
        .prepare(
          `INSERT INTO decisions (id, run_id, question_id, response_id, task_id, agent_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(newId(), question.runId, questionId, id, question.taskId, question.agentId, option ?? text ?? '', ts);
      const response = this.store.getResponse(id)!;
      emit({
        runId: question.runId,
        type: 'response.submitted',
        source: 'owner',
        agentId: question.agentId,
        taskId: question.taskId,
        questionId,
        responseId: id,
        payload: { option, text, questionVersion: question.questionVersion },
      });
      return { response, created: true };
    });
  }

  listQuestions(runId: string, status?: string) {
    return this.store.listQuestions(runId, status);
  }

  // ---- reads --------------------------------------------------------------------------

  getState(run: Run | null): StateSnapshot {
    const now = Date.now();
    if (!run) {
      return {
        run: null,
        agents: [],
        tasks: [],
        questions: [],
        responses: [],
        taskResults: [],
        verifications: [],
        lastRuntimeEventAt: null,
        serverTime: nowIso(),
        config: { staleAfterMin: this.config.staleAfterMin, leadPickupAfterSec: this.config.leadPickupAfterSec },
      };
    }
    const blocking = this.store.openBlockingQuestionIdsByAgent(run.id);
    const agents: AgentView[] = this.store.listAgents(run.id).map((a) => {
      const ids = blocking.get(a.id) ?? [];
      return { ...a, execState: deriveExecState(a, ids.length, now, this.config.staleAfterMin), openBlockingQuestionIds: ids };
    });
    const responses: ResponseView[] = this.store.listResponses(run.id).map((r) => this.withResumed(r));
    return {
      run,
      agents,
      tasks: this.store.listTasks(run.id),
      questions: this.store.listQuestions(run.id),
      responses,
      taskResults: this.store.listTaskResults(run.id),
      verifications: this.store.listVerifications(run.id),
      lastRuntimeEventAt: this.store.lastRuntimeEventAt(run.id),
      serverTime: nowIso(),
      config: { staleAfterMin: this.config.staleAfterMin, leadPickupAfterSec: this.config.leadPickupAfterSec },
    };
  }

  withResumed(r: Response): ResponseView {
    if (r.state !== 'acknowledged') return { ...r, resumedAfterAck: false };
    const seq = this.store.ackEventSeq(r.id);
    return { ...r, resumedAfterAck: seq !== null && this.store.agentActivityAfterSeq(r.agentId, seq) };
  }

  leadInbox(run: Run | null) {
    if (!run) return { items: [] as InboxItem[] };
    const cutoff = new Date(Date.now() - this.config.leadPickupAfterSec * 1000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM responses WHERE run_id = ? AND state = 'submitted' AND submitted_at <= ? ORDER BY submitted_at`,
      )
      .all(run.id, cutoff) as Record<string, unknown>[];
    const items: InboxItem[] = [];
    for (const row of rows) {
      const response = this.store.getResponse(row.id as string)!;
      const question = this.store.getQuestion(response.questionId);
      const agent = this.store.getAgent(response.agentId);
      if (!question || !agent) continue;
      items.push({
        response,
        question,
        agent: { id: agent.id, name: agent.name, role: agent.role, runtimeAgentId: agent.runtimeAgentId },
        ageSec: Math.floor((Date.now() - Date.parse(response.submittedAt)) / 1000),
      });
    }
    return { items };
  }

  eventsAfter(runId: string | null, afterSeq: number) {
    return this.store.eventsAfter(runId, afterSeq);
  }

  // ---- agent operations ---------------------------------------------------------------

  reportStatus(
    agent: Agent,
    input: { clientEventId: string; state: SelfState; taskId?: string | null; message: string },
  ): { event: ConsoleEvent; duplicate: boolean } {
    const dup = this.store.getEventByClientId(agent.id, input.clientEventId);
    if (dup) return { event: dup, duplicate: true };
    const task = input.taskId ? this.store.getTask(input.taskId) : null;
    if (input.taskId && (!task || task.runId !== agent.runId)) throw notFound('task');
    return this.tx((emit) => {
      const ts = nowIso();
      this.db
        .prepare(
          `UPDATE agents SET self_state = ?, current_task_id = COALESCE(?, current_task_id), last_agent_update_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(input.state, input.taskId ?? null, ts, ts, agent.id);
      if (task && task.status === 'ready' && input.state === 'working') {
        this.db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(ts, task.id);
        emit({
          runId: agent.runId,
          type: 'task.updated',
          source: 'agent',
          taskId: task.id,
          agentId: agent.id,
          payload: { previousStatus: 'ready', status: 'in_progress', changes: ['status'], reason: 'agent_started' },
        });
      }
      const event = emit({
        runId: agent.runId,
        type: 'agent.status',
        source: 'agent',
        agentId: agent.id,
        taskId: input.taskId ?? null,
        payload: { state: input.state, message: redact(input.message) },
        clientEventId: input.clientEventId,
      });
      return { event, duplicate: false };
    });
  }

  log(agent: Agent, input: { clientEventId: string; message: string }): { event: ConsoleEvent; duplicate: boolean } {
    const dup = this.store.getEventByClientId(agent.id, input.clientEventId);
    if (dup) return { event: dup, duplicate: true };
    return this.tx((emit) => {
      const ts = nowIso();
      this.db.prepare('UPDATE agents SET last_agent_update_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, agent.id);
      const event = emit({
        runId: agent.runId,
        type: 'agent.log',
        source: 'agent',
        agentId: agent.id,
        taskId: agent.currentTaskId,
        payload: { message: redact(input.message) },
        clientEventId: input.clientEventId,
      });
      return { event, duplicate: false };
    });
  }

  askQuestion(
    agent: Agent,
    input: {
      clientRequestId: string;
      taskId: string;
      question: string;
      why: string;
      options?: string[] | null;
      recommendation?: string | null;
      blocking: boolean;
      supersedesQuestionId?: string | null;
    },
  ): { question: Question; created: boolean } {
    const task = this.store.getTask(input.taskId);
    if (!task || task.runId !== agent.runId) throw notFound('task');
    const existing = this.store.getQuestionByClientRequest(agent.id, input.clientRequestId);
    const cleaned = {
      question: redact(input.question),
      why: redact(input.why ?? ''),
      options: input.options && input.options.length ? input.options.map(redact) : null,
      recommendation: input.recommendation ? redact(input.recommendation) : null,
    };
    if (existing) {
      const same =
        existing.question === cleaned.question &&
        existing.why === cleaned.why &&
        JSON.stringify(existing.options) === JSON.stringify(cleaned.options) &&
        existing.recommendation === cleaned.recommendation &&
        existing.blocking === input.blocking;
      if (same || existing.status !== 'open') return { question: existing, created: false };
      // Same clientRequestId, revised content while still open: bump the version so stale answers are rejected.
      return this.tx((emit) => {
        const ts = nowIso();
        this.db
          .prepare(
            `UPDATE questions SET version = version + 1, question = ?, why = ?, options_json = ?, recommendation = ?, blocking = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            cleaned.question,
            cleaned.why,
            cleaned.options ? JSON.stringify(cleaned.options) : null,
            cleaned.recommendation,
            input.blocking ? 1 : 0,
            ts,
            existing.id,
          );
        const question = this.store.getQuestion(existing.id)!;
        emit({
          runId: agent.runId,
          type: 'question.asked',
          source: 'agent',
          agentId: agent.id,
          taskId: question.taskId,
          questionId: question.id,
          payload: { ...publicQuestionPayload(question), revised: true },
        });
        return { question, created: false };
      });
    }
    let superseded: Question | null = null;
    if (input.supersedesQuestionId) {
      superseded = this.store.getQuestion(input.supersedesQuestionId);
      if (!superseded || superseded.agentId !== agent.id) throw notFound('supersedesQuestionId');
      if (superseded.status !== 'open' && superseded.status !== 'answered') {
        throw conflict(`cannot supersede a question that is ${superseded.status}`);
      }
    }
    return this.tx((emit) => {
      const id = newId();
      const ts = nowIso();
      this.db
        .prepare(
          `INSERT INTO questions (id, run_id, agent_id, task_id, version, question, why, options_json, recommendation, blocking, status, supersedes_question_id, client_request_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
        )
        .run(
          id,
          agent.runId,
          agent.id,
          input.taskId,
          cleaned.question,
          cleaned.why,
          cleaned.options ? JSON.stringify(cleaned.options) : null,
          cleaned.recommendation,
          input.blocking ? 1 : 0,
          superseded?.id ?? null,
          input.clientRequestId,
          ts,
          ts,
        );
      this.db.prepare('UPDATE agents SET last_agent_update_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, agent.id);
      if (superseded) {
        this.db
          .prepare("UPDATE questions SET status = 'superseded', superseded_by_question_id = ?, updated_at = ? WHERE id = ?")
          .run(id, ts, superseded.id);
        emit({
          runId: agent.runId,
          type: 'question.superseded',
          source: 'agent',
          agentId: agent.id,
          taskId: superseded.taskId,
          questionId: superseded.id,
          payload: { supersededByQuestionId: id },
        });
      }
      const question = this.store.getQuestion(id)!;
      emit({
        runId: agent.runId,
        type: 'question.asked',
        source: 'agent',
        agentId: agent.id,
        taskId: input.taskId,
        questionId: id,
        payload: publicQuestionPayload(question),
      });
      return { question, created: true };
    });
  }

  /**
   * §4.2 eligibility. Returns the question when the agent may still receive/ack an answer,
   * or throws not_found (wrong agent) / gone (no longer eligible).
   */
  private eligibleQuestion(agent: Agent, questionId: string): Question {
    const question = this.store.getQuestion(questionId);
    if (!question || question.agentId !== agent.id) throw notFound('question');
    if (question.status === 'superseded' || question.status === 'expired' || question.status === 'canceled') {
      throw gone(`question is ${question.status}`, { status: question.status, supersededBy: question.supersededByQuestionId });
    }
    const task = this.store.getTask(question.taskId);
    if (!task) throw gone('task no longer exists');
    if (task.status === 'integrated' || task.status === 'verified') {
      throw gone(`task is ${task.status}`, { taskStatus: task.status });
    }
    if (task.agentId && task.agentId !== agent.id) throw gone('task was reassigned to another agent');
    return question;
  }

  /** One check of the response for a question; does not wait. Marks delivered on first fetch. */
  private checkResponse(agent: Agent, questionId: string): PollResult {
    let question: Question;
    try {
      question = this.eligibleQuestion(agent, questionId);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'gone') return { status: 410, body: err.toBody() };
      throw err;
    }
    if (question.status !== 'answered') return { status: 204 };
    const response = this.store.currentResponseForQuestion(questionId, question.questionVersion);
    if (!response) return { status: 204 };
    if (response.state === 'submitted') {
      const updated = this.tx((emit) => {
        const ts = nowIso();
        this.db
          .prepare(
            `UPDATE responses SET state = 'delivered', delivered_at = ?, delivered_via = 'agent_poll', updated_at = ? WHERE id = ? AND state = 'submitted'`,
          )
          .run(ts, ts, response.id);
        this.db.prepare('UPDATE agents SET last_agent_update_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, agent.id);
        emit({
          runId: agent.runId,
          type: 'response.delivered',
          source: 'agent',
          agentId: agent.id,
          taskId: question.taskId,
          questionId,
          responseId: response.id,
          payload: { via: 'agent_poll' },
        });
        return this.store.getResponse(response.id)!;
      });
      return { status: 200, body: { response: updated, question } };
    }
    return { status: 200, body: { response, question } };
  }

  /** Long-poll up to `waitSec` seconds for the owner's answer. */
  async getUserResponse(agent: Agent, questionId: string, waitSec: number): Promise<PollResult> {
    const deadline = Date.now() + Math.min(Math.max(waitSec, 0), 30) * 1000;
    for (;;) {
      const result = this.checkResponse(agent, questionId);
      if (result.status !== 204) return result;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return result;
      const woke = await this.waitForEvent(
        (ev) => ev.questionId === questionId || (ev.type === 'task.updated' && ev.taskId !== null),
        remaining,
      );
      if (!woke) return this.checkResponse(agent, questionId);
    }
  }

  private waitForEvent(match: (ev: ConsoleEvent) => boolean, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const onEvent = (ev: ConsoleEvent) => {
        if (!match(ev)) return;
        cleanup();
        resolve(true);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.bus.off('event', onEvent);
      };
      this.bus.on('event', onEvent);
    });
  }

  acknowledgeResponse(
    agent: Agent,
    questionId: string,
    input: { responseId: string; note?: string | null },
  ): { response: Response; changed: boolean } {
    const question = this.eligibleQuestion(agent, questionId);
    const response = this.store.getResponse(input.responseId);
    if (!response || response.questionId !== questionId) throw notFound('response');
    if (response.questionVersion !== question.questionVersion) {
      throw gone('response is for an earlier version of the question', {
        responseVersion: response.questionVersion,
        questionVersion: question.questionVersion,
      });
    }
    if (response.state === 'acknowledged') return { response, changed: false };
    return this.tx((emit) => {
      const ts = nowIso();
      const ev = emit({
        runId: agent.runId,
        type: 'response.acknowledged',
        source: 'agent',
        agentId: agent.id,
        taskId: question.taskId,
        questionId,
        responseId: response.id,
        payload: { note: input.note ? redact(input.note) : null, previousState: response.state },
      });
      this.db
        .prepare(
          `UPDATE responses SET state = 'acknowledged', acknowledged_at = ?, ack_event_seq = ?, ack_note = ?, updated_at = ? WHERE id = ?`,
        )
        .run(ts, ev.seq, input.note ? redact(input.note) : null, ts, response.id);
      this.db.prepare('UPDATE agents SET last_agent_update_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, agent.id);
      return { response: this.store.getResponse(response.id)!, changed: true };
    });
  }

  reportTaskResult(
    agent: Agent,
    taskId: string,
    input: {
      clientRequestId: string;
      status: 'completed' | 'failed';
      summary: string;
      branch: string;
      commit?: string | null;
      changedFiles: string[];
      testsRun: { command: string; passed: boolean; summary: string }[];
      limitations: string[];
      followUps: string[];
    },
  ): { result: TaskResult; task: Task; duplicate: boolean } {
    const task = this.store.getTask(taskId);
    if (!task || task.runId !== agent.runId) throw notFound('task');
    if (task.agentId && task.agentId !== agent.id) throw notFound('task');
    const dup = this.store.getTaskResultByClientRequest(agent.id, input.clientRequestId);
    if (dup) return { result: dup, task, duplicate: true };
    return this.tx((emit) => {
      const id = newId();
      const ts = nowIso();
      this.db
        .prepare(
          `INSERT INTO task_results (id, run_id, task_id, agent_id, status, summary, branch, commit_sha, changed_files_json, tests_run_json, limitations_json, follow_ups_json, client_request_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          agent.runId,
          taskId,
          agent.id,
          input.status,
          redact(input.summary),
          input.branch,
          input.commit ?? null,
          JSON.stringify(input.changedFiles),
          JSON.stringify(redactDeep(input.testsRun)),
          JSON.stringify(input.limitations.map(redact)),
          JSON.stringify(input.followUps.map(redact)),
          input.clientRequestId,
          ts,
        );
      // Agents never set integrated/verified. A closed task stays closed.
      const closed = task.status === 'integrated' || task.status === 'verified';
      const nextStatus: TaskStatus = closed ? task.status : input.status === 'completed' ? 'ready_for_review' : 'blocked';
      if (nextStatus !== task.status) {
        this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, ts, taskId);
        emit({
          runId: agent.runId,
          type: 'task.updated',
          source: 'agent',
          taskId,
          agentId: agent.id,
          payload: { previousStatus: task.status, status: nextStatus, changes: ['status'], reason: 'task_result' },
        });
      }
      this.db
        .prepare("UPDATE agents SET self_state = 'idle', last_agent_update_at = ?, updated_at = ? WHERE id = ?")
        .run(ts, ts, agent.id);
      const result = this.store.getTaskResultByClientRequest(agent.id, input.clientRequestId)!;
      emit({
        runId: agent.runId,
        type: 'task.result',
        source: 'agent',
        taskId,
        agentId: agent.id,
        payload: {
          resultId: id,
          status: result.status,
          summary: result.summary,
          branch: result.branch,
          commit: result.commit,
          changedFiles: result.changedFiles,
          testsRun: result.testsRun,
          limitations: result.limitations,
          followUps: result.followUps,
        },
      });
      return { result, task: this.store.getTask(taskId)!, duplicate: false };
    });
  }
}

export interface InboxItem {
  response: Response;
  question: Question;
  agent: { id: string; name: string; role: string; runtimeAgentId: string | null };
  ageSec: number;
}

function publicQuestionPayload(q: Question) {
  return {
    question: q.question,
    why: q.why,
    options: q.options,
    recommendation: q.recommendation,
    blocking: q.blocking,
    questionVersion: q.questionVersion,
    supersedesQuestionId: q.supersedesQuestionId,
  };
}
