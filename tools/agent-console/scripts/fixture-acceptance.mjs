#!/usr/bin/env node
// End-to-end acceptance fixture (npm run fixture:acceptance). Starts the real server on a random
// free port with a temporary DATA_DIR, creates a `fixture` run, registers two fake agents and
// exercises the contract through the HTTP API and the agentctl CLI. Prints a PASS/FAIL table and
// exits non-zero on any failure. Nothing here touches the default .data/console database.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentctl = path.join(packageDir, 'bin', 'agentctl.mjs');
const leadctl = path.join(packageDir, 'bin', 'leadctl.mjs');
const results = [];
let server;
let dataDir;

const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) });
  if (!pass) process.stderr.write(`  FAIL ${name} ${results[results.length - 1].detail}\n`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(packageDir, 'src', 'server.ts')], {
      env: { ...process.env, CONSOLE_PORT: String(port), CONSOLE_DATA_DIR: dataDir, LEAD_PICKUP_AFTER_SEC: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => reject(new Error('server did not start in time:\n' + out)), 20000);
    child.stdout.on('data', (d) => {
      out += d.toString();
      const m = /CONSOLE_URL=(http:\/\/127\.0\.0\.1:\d+)\/#token=([0-9a-f]{64})/.exec(out);
      if (m && /CONSOLE_STATE=listening/.test(out)) {
        clearTimeout(timer);
        resolve({ child, url: m[1], ownerToken: m[2], banner: out.trim() });
      }
    });
    child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}:\n${out}`));
    });
  });
}

async function http(token, method, p, body, headers = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(server.url + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

/** Run agentctl as a child process with the agent's env. Resolves { code, stdout, stderr, json }. */
function runAgentctl(agent, args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [agentctl, ...args],
      {
        env: { ...process.env, CONSOLE_URL: server.url, CONSOLE_AGENT_ID: agent.id, CONSOLE_AGENT_TOKEN: agent.token },
        timeout: timeoutMs,
      },
      (err, stdout, stderr) => {
        let json = null;
        try {
          json = stdout ? JSON.parse(stdout) : null;
        } catch {
          json = null;
        }
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr, json });
      },
    );
  });
}

/** Run leadctl as a child process with the owner token in the env. Resolves { code, stdout, stderr, json }. */
function runLeadctl(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [leadctl, ...args],
      { env: { ...process.env, CONSOLE_URL: server.url, CONSOLE_OWNER_TOKEN: server.ownerToken }, timeout: timeoutMs },
      (err, stdout, stderr) => {
        let json = null;
        try {
          json = stdout ? JSON.parse(stdout) : null;
        } catch {
          json = null;
        }
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr, json });
      },
    );
  });
}

async function readSse(p, token, untilCount, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const res = await fetch(server.url + p, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal });
  const frames = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + timeoutMs;
  while (frames.length < untilCount && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), sleep(deadline - Date.now()).then(() => ({ done: true }))]);
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (block.startsWith(':')) continue;
      const f = {};
      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) f.id = Number(line.slice(3).trim());
        else if (line.startsWith('event:')) f.event = line.slice(6).trim();
        else if (line.startsWith('data:')) f.data = JSON.parse(line.slice(5).trim());
      }
      if (f.data) frames.push(f);
    }
  }
  ctrl.abort();
  return { status: res.status, frames };
}

async function main() {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-console-fixture-'));
  const port = await freePort();
  server = await startServer(port);
  process.stdout.write(`server up on ${server.url} (data: ${dataDir})\n`);
  const owner = (m, p, b, h) => http(server.ownerToken, m, p, b, h);

  // ---- setup --------------------------------------------------------------------------
  const run = (await owner('POST', '/api/runs', { kind: 'fixture', label: 'fixture acceptance' })).body.run;
  check('fixture run is labeled kind=fixture', run && run.kind === 'fixture' && run.fixture === true, run);

  const regA = (await owner('POST', '/api/agents', { runId: run.id, name: 'Fixture Alpha', role: 'frontend', branch: 'wt/a-frontend' })).body;
  const regB = (await owner('POST', '/api/agents', { runId: run.id, name: 'Fixture Beta', role: 'backend', branch: 'wt/does-not-exist' })).body;
  const A = { id: regA.agent.id, token: regA.agentToken };
  const B = { id: regB.agent.id, token: regB.agentToken };
  check('two agents registered with one-time tokens', /^[0-9a-f]{64}$/.test(A.token) && /^[0-9a-f]{64}$/.test(B.token));

  const tA = (await owner('POST', '/api/tasks', { runId: run.id, id: 'FX-A', title: 'Alpha task', objective: 'x', agentId: A.id })).body.task;
  const tB = (await owner('POST', '/api/tasks', { runId: run.id, id: 'FX-B', title: 'Beta task', objective: 'y', agentId: B.id })).body.task;
  check('tasks created', tA?.status === 'ready' && tB?.status === 'ready');

  // ---- agents report status and ask via the agentctl code path ---------------------------
  const stA = await runAgentctl(A, ['status', '--state', 'working', '--task', tA.id, '--message', 'starting alpha']);
  check('agentctl status (alpha) exits 0', stA.code === 0 && stA.json?.event?.type === 'agent.status', stA.stderr);

  const askA = await runAgentctl(A, ['ask', '--task', tA.id, '--question', 'Alpha: tabs or spaces?', '--why', 'style', '--options', 'tabs|spaces', '--recommend', 'spaces', '--blocking']);
  const askB = await runAgentctl(B, ['ask', '--task', tB.id, '--question', 'Beta: SQLite or Postgres?', '--why', 'storage', '--options', 'sqlite|postgres', '--recommend', 'sqlite', '--blocking']);
  const qA = askA.json?.questionId;
  const qB = askB.json?.questionId;
  check('agentctl ask (alpha) printed questionId', typeof qA === 'string', askA.stderr);
  check('agentctl ask (beta) printed questionId', typeof qB === 'string', askB.stderr);

  const stateAfterAsk = (await owner('GET', `/api/state?runId=${run.id}`)).body;
  const alphaView = stateAfterAsk.agents.find((a) => a.id === A.id);
  check('alpha execState derived waiting_for_you while selfState=working', alphaView?.execState === 'waiting_for_you' && alphaView?.selfState === 'working', alphaView && { execState: alphaView.execState, selfState: alphaView.selfState });
  check('open queue lists both questions', (await owner('GET', `/api/questions?runId=${run.id}&status=open`)).body.questions.length === 2);

  // ---- start both agents waiting (with --ack) BEFORE answering -----------------------------
  const waitA = runAgentctl(A, ['wait', qA, '--timeout', '60', '--ack']);
  const waitB = runAgentctl(B, ['wait', qB, '--timeout', '60', '--ack']);
  await sleep(700);

  // ---- owner answers with duplicate submissions ---------------------------------------------
  const seqBeforeAnswers = (await owner('GET', `/api/state?runId=${run.id}`)).body; // snapshot only
  void seqBeforeAnswers;
  const ansA1 = await owner('POST', `/api/questions/${qA}/responses`, { clientRequestId: 'fx-a-1', questionVersion: 1, option: 'spaces' });
  const ansA2 = await owner('POST', `/api/questions/${qA}/responses`, { clientRequestId: 'fx-a-1', questionVersion: 1, option: 'spaces' });
  const ansA3 = await owner('POST', `/api/questions/${qA}/responses`, { clientRequestId: 'fx-a-2', questionVersion: 1, option: 'tabs' });
  check('first submission 201', ansA1.status === 201, ansA1);
  check('same clientRequestId returns the same response (idempotent)', ansA2.status === 200 && ansA2.body?.response?.id === ansA1.body?.response?.id, ansA2);
  check('different clientRequestId on answered question is 409 conflict', ansA3.status === 409 && ansA3.body?.error?.code === 'conflict', ansA3);

  const ansB1 = await owner('POST', `/api/questions/${qB}/responses`, { clientRequestId: 'fx-b-1', questionVersion: 1, text: 'sqlite, keep it local' });
  check('beta answered', ansB1.status === 201, ansB1);
  const versionMismatch = await owner('POST', `/api/questions/${qB}/responses`, { clientRequestId: 'fx-b-9', questionVersion: 2, text: 'x' });
  check('version mismatch / non-open question is 409', versionMismatch.status === 409, versionMismatch);

  // ---- each answer reaches only its own agent ----------------------------------------------
  const [doneA, doneB] = await Promise.all([waitA, waitB]);
  check('agentctl wait (alpha) received its own answer and acked', doneA.code === 0 && doneA.json?.response?.option === 'spaces' && doneA.json?.response?.state === 'acknowledged' && doneA.json?.response?.questionId === qA, doneA.stderr || doneA.json?.response);
  check('agentctl wait (beta) received its own answer and acked', doneB.code === 0 && doneB.json?.response?.text === 'sqlite, keep it local' && doneB.json?.response?.state === 'acknowledged', doneB.stderr || doneB.json?.response);
  check('alpha response delivered via agent_poll', doneA.json?.response?.deliveredVia === 'agent_poll', doneA.json?.response?.deliveredVia);

  const crossFetch = await http(B.token, 'GET', `/api/agent/${B.id}/questions/${qA}/response`);
  check("beta cannot fetch alpha's question (404, no existence leak)", crossFetch.status === 404, crossFetch);
  const crossAgentPath = await http(B.token, 'GET', `/api/agent/${A.id}/questions/${qA}/response`);
  check("beta token on alpha's path is 404", crossAgentPath.status === 404, crossAgentPath);

  // ---- resumedAfterAck -----------------------------------------------------------------------
  let st = (await owner('GET', `/api/state?runId=${run.id}`)).body;
  const respA = st.responses.find((r) => r.questionId === qA);
  check('resumedAfterAck false right after ack', respA?.state === 'acknowledged' && respA?.resumedAfterAck === false, respA && { state: respA.state, resumedAfterAck: respA.resumedAfterAck });
  const followUp = await runAgentctl(A, ['status', '--state', 'working', '--task', tA.id, '--message', 'continuing with spaces']);
  check('follow-up status accepted', followUp.code === 0, followUp.stderr);
  st = (await owner('GET', `/api/state?runId=${run.id}`)).body;
  const respA2 = st.responses.find((r) => r.questionId === qA);
  const respB2 = st.responses.find((r) => r.questionId === qB);
  check('resumedAfterAck true after follow-up status from the same agent', respA2?.resumedAfterAck === true, respA2?.resumedAfterAck);
  check("beta's response not marked resumed by alpha's activity", respB2?.resumedAfterAck === false, respB2?.resumedAfterAck);

  // ---- SSE replay ------------------------------------------------------------------------------
  const sse = await readSse(`/api/stream?runId=${run.id}&after=0`, server.ownerToken, 10_000, 1500);
  check('SSE stream is 200 for the owner', sse.status === 200, sse.status);
  const allSeqs = sse.frames.map((f) => f.id);
  const cut = allSeqs[Math.floor(allSeqs.length / 2)];
  const expected = sse.frames.filter((f) => f.id > cut).map((f) => f.id);
  const replay = await readSse(`/api/stream?runId=${run.id}&after=${cut}`, server.ownerToken, expected.length, 3000);
  const got = replay.frames.map((f) => f.id);
  const strictlyIncreasing = got.every((v, i) => i === 0 || v > got[i - 1]);
  check('SSE replay from an earlier seq returns the missed events in order without duplicates', got.length === expected.length && got.every((v, i) => v === expected[i]) && strictlyIncreasing && new Set(got).size === got.length, { expected, got });
  check('SSE frames carry id=seq, event=type and matching data', replay.frames.every((f) => f.data.seq === f.id && f.data.type === f.event && f.data.runId === run.id));
  const eventTypes = new Set(sse.frames.map((f) => f.event));
  check('stream contains the lifecycle events', ['run.created', 'agent.registered', 'task.created', 'agent.status', 'question.asked', 'response.submitted', 'response.delivered', 'response.acknowledged'].every((t) => eventTypes.has(t)), [...eventTypes]);

  // ---- superseded question → 410 to wait ----------------------------------------------------------
  const askOld = await runAgentctl(A, ['ask', '--task', tA.id, '--question', 'Old question?', '--why', 'w', '--blocking']);
  const qOld = askOld.json?.questionId;
  const waitOld = runAgentctl(A, ['wait', qOld, '--timeout', '30']);
  await sleep(500);
  const askNew = await runAgentctl(A, ['ask', '--task', tA.id, '--question', 'New question replacing the old one?', '--why', 'w', '--blocking', '--supersedes', qOld]);
  check('superseding ask succeeded', askNew.code === 0 && askNew.json?.question?.supersedesQuestionId === qOld, askNew.stderr);
  const doneOld = await waitOld;
  check('agentctl wait on superseded question exits 3 (410 gone)', doneOld.code === 3 && /410 gone/.test(doneOld.stderr), { code: doneOld.code, stderr: doneOld.stderr.trim() });
  const oldAnswer = await owner('POST', `/api/questions/${qOld}/responses`, { clientRequestId: 'fx-old', questionVersion: 1, text: 'too late' });
  check('owner cannot answer a superseded question (409)', oldAnswer.status === 409, oldAnswer);

  // ---- lead inbox + lead continuation ------------------------------------------------------------
  const qNew = askNew.json.questionId;
  await owner('POST', `/api/questions/${qNew}/responses`, { clientRequestId: 'fx-new', questionVersion: 1, text: 'answer for the new question' });
  const inbox = await owner('GET', `/api/lead/inbox?runId=${run.id}`);
  const inboxIds = inbox.body.items.map((i) => i.question.id);
  check('lead inbox lists the unfetched submitted response', inbox.status === 200 && inboxIds.includes(qNew) && !inboxIds.includes(qA), inboxIds);
  const respNewId = inbox.body.items.find((i) => i.question.id === qNew)?.response.id;
  const md = await owner('POST', '/api/runtime/events', { type: 'message.delivered', responseId: respNewId, details: { via: 'SendMessage' } });
  st = (await owner('GET', `/api/state?runId=${run.id}`)).body;
  const respNew = st.responses.find((r) => r.id === respNewId);
  check('message.delivered marks response delivered via lead_continuation', md.status === 201 && respNew?.state === 'delivered' && respNew?.deliveredVia === 'lead_continuation', respNew && { state: respNew.state, via: respNew.deliveredVia });
  const ackNew = await runAgentctl(A, ['ack', qNew, respNewId]);
  check('agent ack after lead continuation', ackNew.code === 0 && ackNew.json?.response?.state === 'acknowledged', ackNew.stderr);

  // ---- unauthorized ---------------------------------------------------------------------------------
  const noTok = await http(null, 'GET', '/api/state');
  const wrongTok = await http('f'.repeat(64), 'GET', '/api/state');
  const badOrigin = await owner('GET', '/api/state', undefined, { origin: 'http://evil.example' });
  const okOrigin = await owner('GET', '/api/runs', undefined, { origin: 'http://localhost:4800' });
  const agentOnOwner = await http(A.token, 'GET', '/api/state');
  const wrongAgentTok = await http('e'.repeat(64), 'POST', `/api/agent/${A.id}/log`, { clientEventId: 'z', message: 'z' });
  check('no token → 401 envelope', noTok.status === 401 && noTok.body?.error?.code === 'unauthorized', noTok);
  check('wrong owner token → 401', wrongTok.status === 401, wrongTok.status);
  check('bad Origin → 401', badOrigin.status === 401, badOrigin.status);
  check('allow-listed Origin accepted', okOrigin.status === 200, okOrigin.status);
  check('agent token on owner route → 401', agentOnOwner.status === 401, agentOnOwner.status);
  check('unknown agent token → 401', wrongAgentTok.status === 401, wrongAgentTok.status);

  // ---- report_task_result ----------------------------------------------------------------------------
  const testsFile = path.join(dataDir, 'tests.json');
  fs.writeFileSync(testsFile, JSON.stringify([{ command: 'npm test', passed: true, summary: '30 passed' }]));
  const resA = await runAgentctl(A, ['result', '--task', tA.id, '--status', 'completed', '--summary', 'alpha done', '--branch', 'wt/a-frontend', '--commit', 'abc123', '--changed-files', 'a.ts,b.ts', '--tests-json', testsFile, '--limitations', 'none', '--follow-ups', 'review']);
  check('agentctl result sets task ready_for_review', resA.code === 0 && resA.json?.task?.status === 'ready_for_review', resA.stderr || resA.json?.task?.status);
  const resIntegrated = await http(A.token, 'POST', `/api/agent/${A.id}/tasks/${tA.id}/result`, { clientRequestId: 'fx-int', status: 'integrated', summary: 's', branch: 'wt/a-frontend' });
  check('report_task_result cannot set integrated (400 validation_error)', resIntegrated.status === 400 && resIntegrated.body?.error?.code === 'validation_error', resIntegrated);
  st = (await owner('GET', `/api/state?runId=${run.id}`)).body;
  check('task status still ready_for_review after rejected integrated attempt', st.tasks.find((t) => t.id === tA.id)?.status === 'ready_for_review');
  const noVerification = await owner('PATCH', `/api/tasks/${tA.id}`, { status: 'integrated' });
  check('PATCH integrated without verificationId is rejected', noVerification.status === 400, noVerification.status);
  const ver = await owner('POST', '/api/verifications', { taskId: tA.id, kind: 'tests', command: 'npm test', resultSummary: 'fixture verification', passed: true, evidence: { note: 'fixture' } });
  const integrated = await owner('PATCH', `/api/tasks/${tA.id}`, { status: 'integrated', verificationId: ver.body?.verification?.id });
  check('PATCH integrated with verificationId succeeds', integrated.status === 200 && integrated.body?.task?.status === 'integrated', integrated.body);

  // ---- runtime events and git ----------------------------------------------------------------------
  const completed = await owner('POST', '/api/runtime/events', { type: 'agent.completed', agentId: A.id, details: { runtimeAgentId: 'rt-alpha' } });
  st = (await owner('GET', `/api/state?runId=${run.id}`)).body;
  check('agent.completed runtime event derives execState completed', completed.status === 201 && st.agents.find((a) => a.id === A.id)?.execState === 'completed');
  const gitA = await owner('GET', `/api/git/agents/${A.id}`);
  const gitB = await owner('GET', `/api/git/agents/${B.id}`);
  check('git route answers for an existing branch', gitA.status === 200 && typeof gitA.body?.ahead === 'number' && Array.isArray(gitA.body?.commits), gitA.body?.error ?? gitA.status);
  check('git route handles a missing branch gracefully', gitB.status === 200 && gitB.body?.exists === false && /not found/.test(gitB.body?.error ?? ''), gitB.body);

  // ---- leadctl single-word commands with a positional argument (D-1) ---------------------------
  const askLead = await runAgentctl(B, ['ask', '--task', tB.id, '--question', 'Beta: answered via leadctl?', '--why', 'cli', '--options', 'yes|no', '--recommend', 'yes']);
  const qLead = askLead.json?.questionId;
  const leadAnswer = await runLeadctl(['answer', qLead, '--version', '1', '--option', 'yes']);
  check('leadctl answer <questionId> submits the response (D-1)', leadAnswer.code === 0 && leadAnswer.json?.response?.questionId === qLead && leadAnswer.json?.response?.option === 'yes', leadAnswer.stderr || leadAnswer.json);
  const waitLead = await runAgentctl(B, ['wait', qLead, '--timeout', '10', '--ack']);
  check('answer submitted via leadctl reaches the agent (agentctl wait --ack)', waitLead.code === 0 && waitLead.json?.response?.state === 'acknowledged' && waitLead.json?.response?.option === 'yes', waitLead.stderr);
  const leadGit = await runLeadctl(['git', A.id]);
  check('leadctl git <agentId> returns git corroboration (D-1)', leadGit.code === 0 && typeof leadGit.json?.exists === 'boolean' && Array.isArray(leadGit.json?.commits), leadGit.stderr || leadGit.json);
  const leadBad = await runLeadctl(['answer']);
  check('leadctl answer without an id prints usage, not "unknown command"', leadBad.code === 1 && /questionId is required/.test(leadBad.stderr) && !/unknown command/.test(leadBad.stderr), leadBad.stderr.trim().split('\n')[0]);

  // ---- redaction ---------------------------------------------------------------------------------------
  const leak = await runAgentctl(B, ['log', '--message', 'token sk-ABCDEFGHIJKLMNOPQRST and ghp_ABCDEFGHIJKLMNOP']);
  check('secrets redacted in stored log event', leak.code === 0 && leak.json?.event?.payload?.message === 'token [redacted] and [redacted]', leak.json?.event?.payload);

  // ---- restart keeps state -----------------------------------------------------------------------------
  server.child.kill('SIGTERM');
  await new Promise((r) => server.child.on('exit', r));
  server = await startServer(port);
  const after = await http(server.ownerToken, 'GET', `/api/state?runId=${run.id}`);
  check('restart keeps owner token, run, agents, questions and responses', after.status === 200 && after.body?.agents?.length === 2 && after.body?.responses?.length >= 3 && /run=none/.test(server.banner) === true, { agents: after.body?.agents?.length, banner: server.banner.split('\n')[1] });
}

let failed = false;
try {
  await main();
} catch (err) {
  check('fixture completed without exceptions', false, err instanceof Error ? err.stack ?? err.message : String(err));
} finally {
  if (server?.child && server.child.exitCode === null) server.child.kill('SIGTERM');
  const width = Math.max(...results.map((r) => r.name.length), 10);
  process.stdout.write('\n' + 'RESULT  ' + 'CHECK'.padEnd(width) + '\n' + '-'.repeat(width + 8) + '\n');
  for (const r of results) {
    process.stdout.write(`${r.pass ? 'PASS  ' : 'FAIL  '}  ${r.name.padEnd(width)}${r.pass ? '' : '  ' + r.detail}\n`);
  }
  const passed = results.filter((r) => r.pass).length;
  failed = passed !== results.length;
  process.stdout.write('-'.repeat(width + 8) + `\n${passed}/${results.length} checks passed (fixture run kind=fixture; temp data dir ${dataDir})\n`);
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
