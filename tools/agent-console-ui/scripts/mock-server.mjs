#!/usr/bin/env node
/**
 * FIXTURE mock of the agent-console HTTP contract (tools/agent-console/CONTRACT.md).
 * Dev/test only: it is never used in live operation. Everything it serves is labelled
 * FIXTURE and the run has kind 'fixture'.
 *
 *   MOCK_PORT (default 4802)   MOCK_TOKEN (default FIXTURE-OWNER-TOKEN)   MOCK_QUIET=1 (no simulated activity)
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 4802);
const TOKEN = process.env.MOCK_TOKEN ?? 'FIXTURE-OWNER-TOKEN';
const QUIET = process.env.MOCK_QUIET === '1';
const STALE_AFTER_MIN = 20;

const now = () => new Date().toISOString();
const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();

const projectId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const ids = {
  lead: 'a0000000-0000-4000-8000-000000000001',
  fe: 'a0000000-0000-4000-8000-000000000002',
  be1: 'a0000000-0000-4000-8000-000000000003',
  be2: 'a0000000-0000-4000-8000-000000000004',
  qa: 'a0000000-0000-4000-8000-000000000005',
  q1: 'c0000000-0000-4000-8000-000000000001',
  q2: 'c0000000-0000-4000-8000-000000000002',
  q3: 'c0000000-0000-4000-8000-000000000003',
  r1: 'd0000000-0000-4000-8000-000000000001',
  v1: 'e0000000-0000-4000-8000-000000000001',
};

const db = {
  run: { id: runId, projectId, kind: 'fixture', label: 'FIXTURE demo run', createdAt: ago(3600) },
  agents: [
    { id: ids.lead, runId, name: 'FIXTURE lead', role: 'Lead / Integrator', worktree: '.', branch: 'integration', runtimeAgentId: 'main', execState: 'working', lastUpdateAt: ago(40), lastMessage: 'Coordinating console build', createdAt: ago(3500), updatedAt: ago(40) },
    { id: ids.fe, runId, name: 'FIXTURE console-ui', role: 'Product Design / Frontend', worktree: '.worktrees/console-ui', branch: 'wt/console-ui', runtimeAgentId: 'console-ui', execState: 'working', lastUpdateAt: ago(90), lastMessage: 'Wiring SSE reader', createdAt: ago(3000), updatedAt: ago(90) },
    { id: ids.be1, runId, name: 'FIXTURE console-runtime', role: 'Backend / Team Platform', worktree: '.worktrees/console-runtime', branch: 'wt/console-runtime', runtimeAgentId: 'console-runtime', execState: 'working', lastUpdateAt: ago(20), lastMessage: 'Implementing /api/stream replay', createdAt: ago(3000), updatedAt: ago(20) },
    { id: ids.be2, runId, name: 'FIXTURE platform-2', role: 'Backend / Team Platform', worktree: '.worktrees/platform-2', branch: 'wt/platform-2', runtimeAgentId: 'platform-2', execState: 'waiting_on_dependency', blockedByTaskId: 'B1', lastUpdateAt: ago(1500), lastMessage: 'Waiting for schema from B1', createdAt: ago(2900), updatedAt: ago(1500) },
    { id: ids.qa, runId, name: 'FIXTURE qa', role: 'QA / Security', worktree: '.worktrees/qa', branch: 'wt/qa', runtimeAgentId: 'qa', execState: 'completed', lastUpdateAt: ago(600), lastMessage: 'Verification run complete', createdAt: ago(2800), updatedAt: ago(600) },
  ],
  tasks: [
    { id: 'L1', runId, title: 'Coordinate console build', objective: 'Integrate the UI and runtime branches.', acceptanceCriteria: ['UI served from runtime', 'All tests pass'], agentId: ids.lead, dependsOn: ['F1', 'B1'], allowedPaths: ['tools/**'], branch: 'integration', status: 'in_progress', createdAt: ago(3400) },
    { id: 'F1', runId, title: 'Build the console UI', objective: 'Graph of agents with question answering.', acceptanceCriteria: ['Nodes per agent instance', 'Questions answerable from node', 'Live updates via SSE'], agentId: ids.fe, dependsOn: ['B1'], allowedPaths: ['tools/agent-console-ui/**'], branch: 'wt/console-ui', status: 'in_progress', createdAt: ago(3000) },
    { id: 'B1', runId, title: 'Build the console runtime', objective: 'HTTP API, SSE stream, SQLite storage.', acceptanceCriteria: ['Contract routes implemented', 'Replay by seq'], agentId: ids.be1, dependsOn: [], allowedPaths: ['tools/agent-console/**'], branch: 'wt/console-runtime', status: 'in_progress', createdAt: ago(3000) },
    { id: 'B2', runId, title: 'Team platform schema', objective: 'Define team/roster tables.', acceptanceCriteria: ['Migration applies'], agentId: ids.be2, dependsOn: ['B1'], allowedPaths: ['packages/**'], branch: 'wt/platform-2', status: 'blocked', createdAt: ago(2900) },
    { id: 'Q1', runId, title: 'Verify contract tests', objective: 'Run the runtime test-suite and record a verification.', acceptanceCriteria: ['Tests pass'], agentId: ids.qa, dependsOn: [], allowedPaths: [], branch: 'wt/qa', status: 'verified', verificationId: ids.v1, createdAt: ago(2800),
      result: { status: 'completed', summary: 'Ran runtime suite; 42 passing.', branch: 'wt/qa', commit: 'abc1234def', changedFiles: ['tools/agent-console/test/contract.test.mjs'], testsRun: [{ command: 'npm test -w tools/agent-console', passed: true, summary: '42 passed' }], limitations: ['No browser test'], followUps: ['Add UI smoke test'], createdAt: ago(700) } },
  ],
  questions: [
    { id: ids.q1, projectId, runId, agentId: ids.fe, taskId: 'F1', questionVersion: 1, question: 'Should manual node positions persist per run or globally?', why: 'Affects how the layout behaves when switching runs.', options: ['Per run', 'Globally'], recommendation: 'Per run', blocking: true, status: 'open', createdAt: ago(300), updatedAt: ago(300) },
    { id: ids.q2, projectId, runId, agentId: ids.be1, taskId: 'B1', questionVersion: 2, question: 'Keep the 10 s git cache or make it configurable?', why: 'Large repos make git status slow.', options: ['Keep 10 s', 'Make configurable'], recommendation: 'Keep 10 s', blocking: false, status: 'open', createdAt: ago(120), updatedAt: ago(100) },
    { id: ids.q3, projectId, runId, agentId: ids.qa, taskId: 'Q1', questionVersion: 1, question: 'Is a 42-test run sufficient evidence?', why: 'Deciding whether to mark Q1 verified.', options: null, recommendation: null, blocking: false, status: 'answered', createdAt: ago(1200), updatedAt: ago(1100) },
  ],
  responses: [
    { id: ids.r1, projectId, runId, agentId: ids.qa, taskId: 'Q1', questionId: ids.q3, questionVersion: 1, clientRequestId: 'fixture-1', text: 'Yes, sufficient for now.', option: null, state: 'acknowledged', deliveredAt: ago(1090), via: 'agent_poll', acknowledgedAt: ago(1080), resumedAfterAck: true, createdAt: ago(1100), updatedAt: ago(1080) },
  ],
  verifications: [
    { id: ids.v1, runId, taskId: 'Q1', kind: 'tests', command: 'npm test -w tools/agent-console', resultSummary: 'FIXTURE: 42 passed, 0 failed', passed: true, evidence: { exitCode: 0 }, recordedBy: 'lead', createdAt: ago(650) },
  ],
  events: [],
  lastRuntimeEventAt: ago(40),
};

let seq = 0;
const clients = new Set();
function emit(type, fields, payload, source = 'agent') {
  seq += 1;
  const ev = { id: randomUUID(), seq, runId, ts: now(), type, source, agentId: null, taskId: null, questionId: null, responseId: null, ...fields, payload };
  db.events.push(ev);
  if (['agent.spawned', 'agent.completed', 'agent.failed', 'agent.resumed', 'message.delivered', 'lead.note'].includes(type)) db.lastRuntimeEventAt = ev.ts;
  for (const res of clients) res.write(frame(ev));
  return ev;
}
const frame = (ev) => `id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;

// Seed history so replay has something to show.
emit('run.created', {}, { run: db.run }, 'system');
for (const a of db.agents) emit('agent.registered', { agentId: a.id }, { agent: a }, 'lead');
for (const t of db.tasks) emit('task.created', { taskId: t.id, agentId: t.agentId }, { task: t }, 'lead');
emit('agent.spawned', { agentId: ids.fe }, { runtimeAgentId: 'console-ui' }, 'runtime');
emit('agent.status', { agentId: ids.fe, taskId: 'F1' }, { state: 'working', taskId: 'F1', message: 'Scaffolding package' });
emit('agent.log', { agentId: ids.be1 }, { message: 'Migrations applied' });
emit('task.result', { agentId: ids.qa, taskId: 'Q1' }, { result: db.tasks[4].result });
emit('verification.recorded', { taskId: 'Q1' }, { verification: db.verifications[0] }, 'lead');
emit('task.updated', { taskId: 'Q1' }, { task: db.tasks[4] }, 'lead');
emit('agent.completed', { agentId: ids.qa }, { message: 'Subagent finished' }, 'runtime');
for (const q of db.questions) emit('question.asked', { agentId: q.agentId, taskId: q.taskId, questionId: q.id }, { question: q });
emit('response.submitted', { agentId: ids.qa, taskId: 'Q1', questionId: ids.q3, responseId: ids.r1 }, { response: { ...db.responses[0], state: 'submitted' } }, 'owner');
emit('response.delivered', { agentId: ids.qa, questionId: ids.q3, responseId: ids.r1 }, { via: 'agent_poll' }, 'system');
emit('response.acknowledged', { agentId: ids.qa, questionId: ids.q3, responseId: ids.r1 }, {}, 'agent');
emit('agent.log', { agentId: ids.qa }, { message: 'Continuing with verification' });

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const err = (res, status, code, message) => json(res, status, { error: { code, message } });

function authed(req) {
  const h = req.headers.authorization ?? '';
  return h === `Bearer ${TOKEN}`;
}

const responsesByClientRequest = new Map();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (!url.pathname.startsWith('/api/')) return err(res, 404, 'not_found', 'mock serves /api only; run the UI with Vite');
  if (!authed(req)) return err(res, 401, 'unauthorized', 'missing or invalid bearer token');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/runs') return json(res, 200, { runs: [db.run] });
  if (req.method === 'GET' && path === '/api/state') {
    return json(res, 200, {
      run: db.run,
      agents: db.agents,
      tasks: db.tasks,
      questions: db.questions,
      responses: db.responses,
      verifications: db.verifications,
      lastRuntimeEventAt: db.lastRuntimeEventAt,
      serverTime: now(),
      staleAfterMin: STALE_AFTER_MIN,
      lastSeq: seq,
    });
  }
  if (req.method === 'GET' && path === '/api/questions') {
    const status = url.searchParams.get('status');
    return json(res, 200, { questions: db.questions.filter((q) => !status || q.status === status) });
  }
  const git = /^\/api\/git\/agents\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && git) {
    const a = db.agents.find((x) => x.id === decodeURIComponent(git[1]));
    if (!a) return err(res, 404, 'not_found', 'no such agent');
    return json(res, 200, {
      branch: a.branch,
      ahead: a.id === ids.qa ? 0 : 3,
      commits: [{ sha: 'f1x7ure0000', subject: `FIXTURE: commit on ${a.branch}`, author: 'FootballOS', date: ago(500) }],
      changedFiles: [`tools/FIXTURE/${a.name.replace(/\s+/g, '-')}.ts`],
      mergedIntoIntegration: a.id === ids.qa,
    });
  }
  const resp = /^\/api\/questions\/([^/]+)\/responses$/.exec(path);
  if (req.method === 'POST' && resp) {
    const body = await readJson(req);
    if (!body || typeof body.clientRequestId !== 'string' || typeof body.questionVersion !== 'number') return err(res, 400, 'validation_error', 'clientRequestId and questionVersion required');
    const existing = responsesByClientRequest.get(body.clientRequestId);
    if (existing) return json(res, 200, existing);
    const q = db.questions.find((x) => x.id === decodeURIComponent(resp[1]));
    if (!q) return err(res, 404, 'not_found', 'no such question');
    if (q.status !== 'open' || q.questionVersion !== body.questionVersion) return err(res, 409, 'conflict', 'question not open or version mismatch');
    if (!body.text && !body.option) return err(res, 400, 'validation_error', 'text or option required');
    const t = now();
    const r = { id: randomUUID(), projectId, runId, agentId: q.agentId, taskId: q.taskId, questionId: q.id, questionVersion: q.questionVersion, clientRequestId: body.clientRequestId, text: body.text ?? null, option: body.option ?? null, state: 'submitted', deliveredAt: null, via: null, acknowledgedAt: null, resumedAfterAck: false, createdAt: t, updatedAt: t };
    db.responses.push(r);
    responsesByClientRequest.set(body.clientRequestId, r);
    q.status = 'answered';
    q.updatedAt = t;
    emit('response.submitted', { agentId: q.agentId, taskId: q.taskId, questionId: q.id, responseId: r.id }, { response: r }, 'owner');
    if (!QUIET) simulateDelivery(q, r);
    return json(res, 201, r);
  }
  if (req.method === 'GET' && path === '/api/stream') {
    const after = Number(url.searchParams.get('after') ?? req.headers['last-event-id'] ?? 0) || 0;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    for (const ev of db.events) if (ev.seq > after) res.write(frame(ev));
    res.write(`: hb ${now()}\n\n`);
    clients.add(res);
    const hb = setInterval(() => res.write(`: hb ${now()}\n\n`), 15000);
    req.on('close', () => {
      clearInterval(hb);
      clients.delete(res);
    });
    return undefined;
  }
  return err(res, 404, 'not_found', `mock has no route ${req.method} ${path}`);
});

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || 'null'));
      } catch {
        resolve(null);
      }
    });
  });
}

function simulateDelivery(q, r) {
  setTimeout(() => {
    r.state = 'delivered';
    r.deliveredAt = now();
    r.via = 'agent_poll';
    r.updatedAt = r.deliveredAt;
    emit('response.delivered', { agentId: q.agentId, questionId: q.id, responseId: r.id }, { via: 'agent_poll', deliveredAt: r.deliveredAt }, 'system');
  }, 3000);
  setTimeout(() => {
    r.state = 'acknowledged';
    r.acknowledgedAt = now();
    r.updatedAt = r.acknowledgedAt;
    emit('response.acknowledged', { agentId: q.agentId, questionId: q.id, responseId: r.id }, {}, 'agent');
  }, 6000);
  setTimeout(() => {
    const a = db.agents.find((x) => x.id === q.agentId);
    if (a) {
      a.execState = 'working';
      a.lastUpdateAt = now();
      a.lastMessage = `Continuing after answer: ${r.option ?? r.text}`;
      a.updatedAt = a.lastUpdateAt;
    }
    r.resumedAfterAck = true;
    emit('agent.status', { agentId: q.agentId, taskId: q.taskId }, { state: 'working', taskId: q.taskId, message: `Continuing after answer: ${r.option ?? r.text}` });
  }, 9000);
}

if (!QUIET) {
  let n = 0;
  setInterval(() => {
    n += 1;
    const a = db.agents[1 + (n % 2)];
    a.lastUpdateAt = now();
    a.lastMessage = `FIXTURE heartbeat log #${n}`;
    a.updatedAt = a.lastUpdateAt;
    emit('agent.log', { agentId: a.id }, { message: a.lastMessage });
    if (n % 6 === 0) emit('lead.note', {}, { note: `FIXTURE lead note #${n / 6}` }, 'lead');
  }, 20000);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock] FIXTURE agent-console API on http://127.0.0.1:${PORT}`);
  console.log(`[mock] open the UI at http://127.0.0.1:4801/#token=${TOKEN}`);
});
