#!/usr/bin/env node
// Independent QA driver for the Agent Build Console (brief §9 scenarios).
// Plain Node >= 22, no dependencies. Drives two fake agents through agentctl/leadctl
// (child processes, distinct credentials) and probes the edge cases with raw fetch.
//
// Usage:
//   node tests/e2e/console-scenarios.mjs run  --url http://127.0.0.1:4810 --data-dir <abs path> [--snapshot out.json]
//   node tests/e2e/console-scenarios.mjs compare --url ... --data-dir ... --snapshot out.json   # after a server restart
//
// Never point this at the live team console (port 4800): it creates runs, agents and questions.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const AGENTCTL = path.join(repoRoot, 'tools/agent-console/bin/agentctl.mjs');
const LEADCTL = path.join(repoRoot, 'tools/agent-console/bin/leadctl.mjs');

const argv = process.argv.slice(2);
const mode = argv[0];
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const URL_ = (flag('url', process.env.CONSOLE_URL || 'http://127.0.0.1:4810')).replace(/\/+$/, '');
const DATA_DIR = flag('data-dir', process.env.CONSOLE_DATA_DIR);
const SNAPSHOT = flag('snapshot', null);
if (!mode || !DATA_DIR) {
  console.error('usage: console-scenarios.mjs run|compare --url <consoleUrl> --data-dir <absolute data dir> [--snapshot file]');
  process.exit(2);
}
if (/:4800\b/.test(URL_)) {
  console.error('refusing to run against port 4800 (the live team console)');
  process.exit(2);
}
const OWNER = fs.readFileSync(path.join(DATA_DIR, 'owner-token'), 'utf8').trim();
// Console task ids are global across runs, so each run gets its own suffix.
const SUF = Math.random().toString(36).slice(2, 6);
const T1 = `QA-T1-${SUF}`;
const T2 = `QA-T2-${SUF}`;

// ---------- reporting ----------
const results = [];
function check(name, ok, evidence) {
  results.push({ name, ok: ok === 'SKIP' ? 'SKIP' : Boolean(ok), evidence: String(evidence ?? '') });
  const tag = ok === 'SKIP' ? 'SKIP' : ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${name}${evidence ? `  -- ${String(evidence).slice(0, 220)}` : ''}`);
}
function finish() {
  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false).length;
  const skip = results.filter((r) => r.ok === 'SKIP').length;
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail ? 1 : 0);
}

// ---------- helpers ----------
async function http(method, p, { token, body, origin, rawAuth } = {}) {
  const headers = {};
  if (rawAuth !== undefined) headers.authorization = rawAuth;
  else if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(URL_ + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}
const ownerGet = (p) => http('GET', p, { token: OWNER });
const ownerPost = (p, body) => http('POST', p, { token: OWNER, body });
const state = async () => (await ownerGet('/api/state')).body;

function cli(bin, args, env = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    env: { ...process.env, CONSOLE_URL: URL_, CONSOLE_DATA_DIR: DATA_DIR, ...env },
    encoding: 'utf8',
    timeout: 120_000,
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
const lead = (args) => cli(LEADCTL, args);
const agentEnv = (a) => ({ CONSOLE_AGENT_ID: a.id, CONSOLE_AGENT_TOKEN: a.token });
const agent = (a, args) => cli(AGENTCTL, args, agentEnv(a));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run agentctl wait in the background; resolves with the process result. */
function agentWaitAsync(a, questionId, extra = []) {
  return new Promise((resolve) => {
    const { spawn } = require_cp();
    const child = spawn(process.execPath, [AGENTCTL, 'wait', questionId, ...extra], {
      env: { ...process.env, CONSOLE_URL: URL_, ...agentEnv(a) },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      let json = null;
      try {
        json = JSON.parse(out);
      } catch {
        json = null;
      }
      resolve({ code, stdout: out, stderr: err, json });
    });
  });
}
import { createRequire } from 'node:module';
const require_cp = () => createRequire(import.meta.url)('node:child_process');

async function readSse(p, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  const frames = [];
  try {
    const res = await fetch(URL_ + p, { headers: { authorization: `Bearer ${OWNER}` }, signal: ac.signal });
    const reader = res.body.getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const f = {};
        for (const line of chunk.split('\n')) {
          if (line.startsWith('id:')) f.id = Number(line.slice(3).trim());
          else if (line.startsWith('event:')) f.event = line.slice(6).trim();
          else if (line.startsWith('data:')) f.data = line.slice(5).trim();
          else if (line.startsWith(':')) f.comment = line;
        }
        frames.push(f);
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  } finally {
    clearTimeout(t);
  }
  return frames;
}

// ---------- compare mode (after restart) ----------
if (mode === 'compare') {
  if (!SNAPSHOT) {
    console.error('--snapshot required for compare');
    process.exit(2);
  }
  const before = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  const after = (await ownerGet(`/api/state?runId=${encodeURIComponent(before.run.id)}`)).body;
  const pick = (s) => ({
    run: s.run.id,
    agents: s.agents.map((a) => [a.id, a.name, a.selfReportedState ?? a.selfState]).sort(),
    tasks: s.tasks.map((t) => [t.id, t.status, t.agentId]).sort(),
    questions: s.questions.map((q) => [q.id, q.status, q.questionVersion]).sort(),
    responses: s.responses.map((r) => [r.id, r.state, r.resumedAfterAck, r.deliveredAt ? 'd' : '-', r.acknowledgedAt ? 'a' : '-']).sort(),
    lastSeq: s.lastSeq,
  });
  const a = JSON.stringify(pick(before));
  const b = JSON.stringify(pick(after));
  check('restart: owner token still valid', after && after.run, `status run=${after?.run?.id}`);
  check('restart: agents/tasks/questions/responses identical to pre-restart snapshot', a === b, a === b ? `${before.agents.length} agents, ${before.tasks.length} tasks, ${before.questions.length} questions, ${before.responses.length} responses, lastSeq ${before.lastSeq}` : `before=${a}\nafter=${b}`);
  if (before._qaAgents) {
    const sA = agent(before._qaAgents.A, ['status', '--state', 'working', '--task', before._qaTasks?.T1 ?? '', '--message', 'alpha after server restart']);
    check('restart: agent token issued before the restart still works (agentctl status 200)', sA.code === 0 && sA.json?.event?.type === 'agent.status', sA.code === 0 ? `seq ${sA.json.event.seq}` : sA.stderr.trim());
  }
  const stream = await readSse(`/api/stream?runId=${before.run.id}&after=0`, 1500);
  const seqs = stream.filter((f) => f.id !== undefined).map((f) => f.id);
  const expectedCount = (before._qaEventCount ?? 0) + (before._qaAgents ? 1 : 0); // + the status just sent
  check('restart: SSE replay from 0 returns every event of the run', seqs.length === expectedCount && seqs.every((s, i) => i === 0 || s > seqs[i - 1]), `replayed ${seqs.length} frames (expected ${expectedCount}), last ${seqs.at(-1)}`);
  finish();
}

// ---------- run mode ----------
console.log(`console ${URL_}, data dir ${DATA_DIR}`);
const health = await http('GET', '/healthz');
check('healthz', health.status === 200 && health.body?.ok === true, JSON.stringify(health.body));

// 1. run + two agents + two tasks (owner token via leadctl)
const runRes = lead(['run', 'create', '--kind', 'live', '--label', `QA A6 scenarios ${new Date().toISOString()}`]);
const run = runRes.json?.run;
check('leadctl run create', runRes.code === 0 && run?.id, runRes.code === 0 ? run.id : runRes.stderr);
if (!run) finish();

const regA = lead(['agent', 'register', '--run', run.id, '--name', 'qa-alpha', '--role', 'QA fake agent A', '--branch', 'wt/e-qa']);
const regB = lead(['agent', 'register', '--run', run.id, '--name', 'qa-beta', '--role', 'QA fake agent B', '--branch', 'wt/e-qa']);
const A = { id: regA.json?.agent?.id, token: regA.json?.agentToken, name: 'qa-alpha' };
const B = { id: regB.json?.agent?.id, token: regB.json?.agentToken, name: 'qa-beta' };
check('leadctl agent register x2 returns distinct ids and tokens', A.id && B.id && A.id !== B.id && A.token && B.token && A.token !== B.token, `${A.id} / ${B.id}`);
if (!A.id || !B.id) finish();

const t1 = lead(['task', 'create', '--run', run.id, '--id', T1, '--title', 'Alpha task', '--objective', 'drive alpha', '--agent', A.id, '--criteria', 'a|b']);
const t2 = lead(['task', 'create', '--run', run.id, '--id', T2, '--title', 'Beta task', '--objective', 'drive beta', '--agent', B.id]);
check('leadctl task create x2', t1.code === 0 && t2.code === 0, `${t1.json?.task?.status} / ${t2.json?.task?.status}`);

// 2. distinct identities via agentctl status
const sA = agent(A, ['status', '--state', 'working', '--task', T1, '--message', 'alpha starting']);
const sB = agent(B, ['status', '--state', 'working', '--task', T2, '--message', 'beta starting']);
let st = await state();
const agA = st.agents.find((a) => a.id === A.id);
const agB = st.agents.find((a) => a.id === B.id);
check('two agents appear with distinct identities and their own tasks', sA.code === 0 && sB.code === 0 && agA?.name === 'qa-alpha' && agB?.name === 'qa-beta' && agA.execState === 'working' && agB.execState === 'working' && st.tasks.find((t) => t.id === T1)?.status === 'in_progress' && st.tasks.find((t) => t.id === T2)?.status === 'in_progress', `alpha=${agA?.execState} beta=${agB?.execState}; T1=${st.tasks.find((t) => t.id === T1)?.status} T2=${st.tasks.find((t) => t.id === T2)?.status}`);
check('agent token on another agent path (wrong :agentId) -> 404', (await http('POST', `/api/agent/${B.id}/status`, { token: A.token, body: { clientEventId: 'x1', state: 'working', message: 'spoof' } })).status === 404);

// 3. two simultaneous questions
const qA = agent(A, ['ask', '--task', T1, '--question', 'Alpha: pick a colour', '--why', 'qa', '--options', 'red|blue', '--recommend', 'red', '--blocking']);
const qB = agent(B, ['ask', '--task', T2, '--question', 'Beta: pick a size', '--why', 'qa', '--options', 'small|large', '--recommend', 'small']);
const QA = qA.json?.questionId;
const QB = qB.json?.questionId;
const openQ = (await ownerGet(`/api/questions?runId=${run.id}&status=open`)).body?.questions ?? [];
st = await state();
check('both agents ask simultaneously; two open questions in the queue', QA && QB && openQ.length === 2 && openQ.some((q) => q.id === QA) && openQ.some((q) => q.id === QB), `open=${openQ.length}`);
check('blocking question derives execState waiting_for_you (alpha), beta stays working', st.agents.find((a) => a.id === A.id)?.execState === 'waiting_for_you' && st.agents.find((a) => a.id === B.id)?.execState === 'working', `alpha=${st.agents.find((a) => a.id === A.id)?.execState} beta=${st.agents.find((a) => a.id === B.id)?.execState}`);

// 4. leadctl answer (defect reproduction) then owner API
const la = lead(['answer', QB, '--version', '1', '--option', 'small']);
check('DEFECT CHECK: leadctl answer <questionId> works', la.code === 0, la.code === 0 ? 'works' : `exit ${la.code}: ${la.stderr.trim().split('\n')[0]}`);
const lg = lead(['git', A.id]);
check('DEFECT CHECK: leadctl git <agentId> works', lg.code === 0, lg.code === 0 ? 'works' : `exit ${lg.code}: ${lg.stderr.trim().split('\n')[0]}`);

// alpha waits (with --ack) in the background before the owner answers
const waitA = agentWaitAsync(A, QA, ['--timeout', '60', '--ack']);
await sleep(800);
const ansA = await ownerPost(`/api/questions/${QA}/responses`, { clientRequestId: 'qa-ans-A-1', questionVersion: 1, option: 'red' });
const ansBReq = { clientRequestId: 'qa-ans-B-1', questionVersion: 1, option: 'small' };
let ansB = await ownerPost(`/api/questions/${QB}/responses`, ansBReq);
if (la.code === 0) ansB = { status: 200, body: { response: la.json.response } }; // leadctl already answered
check('owner answers both questions (201)', ansA.status === 201 && (ansB.status === 201 || la.code === 0), `A=${ansA.status} B=${ansB.status}`);
const RA = ansA.body?.response?.id;
const RB = ansB.body?.response?.id;

// 5. routing: beta cannot fetch alpha's answer
const cross1 = await http('GET', `/api/agent/${B.id}/questions/${QA}/response`, { token: B.token });
const cross2 = await http('GET', `/api/agent/${A.id}/questions/${QA}/response?wait=0`, { token: B.token });
check('cross-agent fetch of another agent question -> 404 (own path) and 404 (other path)', cross1.status === 404 && cross2.status === 404, `${cross1.status}/${cross2.status}`);

const wA = await waitA;
check('alpha long-poll receives its own answer and acks (agentctl wait --ack)', wA.code === 0 && wA.json?.response?.id === RA && wA.json?.response?.state === 'acknowledged' && wA.json?.response?.option === 'red', `exit ${wA.code} state=${wA.json?.response?.state} via=${wA.json?.response?.via ?? wA.json?.response?.deliveredVia}`);
st = await state();
let rA = st.responses.find((r) => r.id === RA);
check('after ack, resumedAfterAck is false until later activity', rA?.state === 'acknowledged' && rA?.resumedAfterAck === false, `state=${rA?.state} resumed=${rA?.resumedAfterAck}`);
agent(A, ['status', '--state', 'working', '--task', T1, '--message', 'alpha continuing with red']);
st = await state();
rA = st.responses.find((r) => r.id === RA);
check('resumedAfterAck becomes true after a later agent.status from the same agent', rA?.resumedAfterAck === true, `resumed=${rA?.resumedAfterAck}`);

// beta: wait without ack, then ack separately
const wB = agent(B, ['wait', QB, '--timeout', '30']);
st = await state();
let rB = st.responses.find((r) => r.id === RB);
check('beta fetch marks delivered via agent_poll (no ack yet)', wB.code === 0 && rB?.state === 'delivered' && (rB?.via ?? rB?.deliveredVia) === 'agent_poll', `state=${rB?.state} via=${rB?.via ?? rB?.deliveredVia}`);
const ackB = agent(B, ['ack', QB, RB]);
const ackB2 = agent(B, ['ack', QB, RB]);
st = await state();
rB = st.responses.find((r) => r.id === RB);
check('beta ack -> acknowledged; repeat ack idempotent (200)', ackB.code === 0 && ackB2.code === 0 && rB?.state === 'acknowledged' && rB?.resumedAfterAck === false, `state=${rB?.state} resumed=${rB?.resumedAfterAck} changed2=${ackB2.json?.changed}`);
agent(B, ['log', '--message', 'beta continuing with small']);
st = await state();
rB = st.responses.find((r) => r.id === RB);
check('resumedAfterAck true after agent.log', rB?.resumedAfterAck === true);

// 6. duplicate submission
const dup = await ownerPost(`/api/questions/${QA}/responses`, { clientRequestId: 'qa-ans-A-1', questionVersion: 1, option: 'red' });
const dupNew = await ownerPost(`/api/questions/${QA}/responses`, { clientRequestId: 'qa-ans-A-2', questionVersion: 1, option: 'blue' });
check('same clientRequestId -> same response id (200), new clientRequestId on answered question -> 409', dup.status === 200 && dup.body?.response?.id === RA && dupNew.status === 409 && dupNew.body?.error?.code === 'conflict', `${dup.status}/${dup.body?.response?.id === RA}/${dupNew.status}`);
st = await state();
check('duplicate did not create a second response', st.responses.filter((r) => r.questionId === QA).length === 1);

// 7. refresh of /api/state reproduces everything
st = await state();
check('/api/state (refresh) reproduces agents, tasks, questions and responses', st.agents.length === 2 && st.tasks.length === 2 && st.questions.filter((q) => q.status === 'answered').length === 2 && st.responses.filter((r) => r.state === 'acknowledged').length === 2, `agents=${st.agents.length} tasks=${st.tasks.length} answered=${st.questions.filter((q) => q.status === 'answered').length} acked=${st.responses.filter((r) => r.state === 'acknowledged').length}`);

// 8. SSE replay from an earlier seq
const all = await readSse(`/api/stream?runId=${run.id}&after=0`, 1500);
const allSeqs = all.filter((f) => f.id !== undefined).map((f) => f.id);
const cut = allSeqs[Math.floor(allSeqs.length / 2)];
const gap = await readSse(`/api/stream?runId=${run.id}&after=${cut}`, 1500);
const gapSeqs = gap.filter((f) => f.id !== undefined).map((f) => f.id);
const expected = allSeqs.filter((s) => s > cut);
const inOrder = gapSeqs.every((s, i) => i === 0 || s > gapSeqs[i - 1]);
const noDup = new Set(gapSeqs).size === gapSeqs.length;
check('SSE replay from earlier seq returns exactly the gap, in order, no duplicates', JSON.stringify(gapSeqs) === JSON.stringify(expected) && inOrder && noDup, `after=${cut}: got ${gapSeqs.length} frames [${gapSeqs[0]}..${gapSeqs.at(-1)}], expected ${expected.length}`);
check('SSE frames carry id/event/data and a heartbeat comment', gap.some((f) => f.comment?.startsWith(': hb')) && gap.filter((f) => f.id !== undefined).every((f) => f.event && f.data), `hb=${gap.some((f) => f.comment?.startsWith(': hb'))}`);
check('SSE replay excludes events of other runs', gap.filter((f) => f.data).every((f) => JSON.parse(f.data).runId === run.id));

// 9. agent.failed stays failed until agent.resumed / agent.spawned
await ownerPost('/api/runtime/events', { type: 'agent.failed', agentId: B.id, details: { reason: 'qa simulated failure' } });
st = await state();
const failed1 = st.agents.find((a) => a.id === B.id)?.execState;
agent(B, ['status', '--state', 'working', '--task', T2, '--message', 'beta self-reports working after failure']);
st = await state();
const failed2 = st.agents.find((a) => a.id === B.id)?.execState;
await ownerPost('/api/runtime/events', { type: 'agent.resumed', agentId: B.id, details: {} });
st = await state();
const resumed = st.agents.find((a) => a.id === B.id)?.execState;
check('agent.failed -> execState failed, stays failed despite self-report, cleared by agent.resumed', failed1 === 'failed' && failed2 === 'failed' && resumed !== 'failed', `${failed1} -> ${failed2} -> ${resumed}`);

// 10. superseded question -> 410 on wait, 409 on answer
const q3 = agent(A, ['ask', '--task', T1, '--question', 'Alpha Q3 (will be superseded)', '--why', 'qa']);
const Q3 = q3.json?.questionId;
const q4 = agent(A, ['ask', '--task', T1, '--question', 'Alpha Q4 supersedes Q3', '--why', 'qa', '--supersedes', Q3]);
const Q4 = q4.json?.questionId;
const w3 = agent(A, ['wait', Q3, '--timeout', '10']);
const a3 = await ownerPost(`/api/questions/${Q3}/responses`, { clientRequestId: 'qa-ans-3', questionVersion: 1, text: 'late' });
const raw3 = await http('GET', `/api/agent/${A.id}/questions/${Q3}/response`, { token: A.token });
check('superseded question: agentctl wait exits 3 (410 gone), owner answer -> 409', Q4 && w3.code === 3 && raw3.status === 410 && a3.status === 409, `wait exit ${w3.code}, raw ${raw3.status} ${raw3.body?.error?.code}, answer ${a3.status}`);
await ownerPost(`/api/questions/${Q4}/responses`, { clientRequestId: 'qa-ans-4', questionVersion: 1, text: 'ok' });
agent(A, ['wait', Q4, '--timeout', '10', '--ack']);

// 11. task reassignment -> 410 to old agent
const q5 = agent(A, ['ask', '--task', T1, '--question', 'Alpha Q5 before reassignment', '--why', 'qa']);
const Q5 = q5.json?.questionId;
await ownerPost(`/api/questions/${Q5}/responses`, { clientRequestId: 'qa-ans-5', questionVersion: 1, text: 'answer 5' });
const reassign = lead(['task', 'set', T1, '--agent', B.id]);
const w5 = agent(A, ['wait', Q5, '--timeout', '10']);
const raw5 = await http('GET', `/api/agent/${A.id}/questions/${Q5}/response`, { token: A.token });
check('task reassigned to another agent: old agent gets 410 (agentctl exit 3)', reassign.code === 0 && w5.code === 3 && raw5.status === 410, `reassign exit ${reassign.code}; wait exit ${w5.code}; raw ${raw5.status} ${raw5.body?.error?.message}`);
lead(['task', 'set', T1, '--agent', A.id]);

// 12. auth
const noTok = await http('GET', '/api/state');
const badTok = await http('GET', '/api/state', { token: 'not-the-owner-token-0000000000000000' });
const badOrigin = await http('GET', '/api/state', { token: OWNER, origin: 'http://evil.example' });
const goodOrigin = await http('GET', '/api/state', { token: OWNER, origin: `http://127.0.0.1:${new URL(URL_).port}` });
const agentNoTok = await http('GET', `/api/agent/${A.id}/questions/${QA}/response`);
const agentBadTok = await http('GET', `/api/agent/${A.id}/questions/${QA}/response`, { token: 'deadbeef' });
const agentOnOwner = await http('GET', '/api/state', { token: A.token });
check('no token -> 401 (owner and agent routes)', noTok.status === 401 && agentNoTok.status === 401 && noTok.body?.error?.code === 'unauthorized', `${noTok.status}/${agentNoTok.status}`);
check('wrong token -> 401 (owner and agent routes); agent token on owner route -> 401', badTok.status === 401 && agentBadTok.status === 401 && agentOnOwner.status === 401, `${badTok.status}/${agentBadTok.status}/${agentOnOwner.status}`);
check('bad Origin with valid owner token -> 401; allowed Origin -> 200', badOrigin.status === 401 && goodOrigin.status === 200, `${badOrigin.status}/${goodOrigin.status}`);
const malformed = [
  ['Bearer', 'Bearer'],
  ['Basic abc', 'Basic abc'],
  ['Bearer two words', 'Bearer a b'],
  ['Bearer <empty>', 'Bearer '],
  ['bare token (no scheme)', OWNER],
  ['Bearer non-ascii', 'Bearer éé'],
];
const malformedResults = [];
for (const [label, hdr] of malformed) {
  try {
    const r = await http('GET', '/api/state', { rawAuth: hdr });
    malformedResults.push(`${label}=${r.status} ${r.body?.error?.code ?? ''}`);
  } catch (e) {
    malformedResults.push(`${label}=client-error(${e.cause?.code ?? e.message})`);
  }
}
check('DEFECT CHECK: malformed Authorization headers answer 401 (not 400)', malformedResults.every((s) => /=401 /.test(s) || /client-error/.test(s)), malformedResults.join('; '));
const malformedPost = await http('POST', `/api/agent/${A.id}/status`, { rawAuth: 'Bearer', body: { clientEventId: 'z', state: 'working', message: '' } });
const bodyWithBadToken = await http('POST', `/api/agent/${A.id}/status`, { token: 'deadbeef', body: 'not json' });
check('auth check runs before body validation (bad token + bad body -> 401, not 400)', malformedPost.status === 401 && bodyWithBadToken.status === 401, `${malformedPost.status}/${bodyWithBadToken.status}`);

// 13. report_task_result cannot set integrated
const fakeTests = path.join(DATA_DIR, 'qa-tests.json');
fs.writeFileSync(fakeTests, JSON.stringify([{ command: 'npm test -w nothing', passed: true, summary: 'qa fake' }]));
const resB = agent(B, ['result', '--task', T2, '--status', 'completed', '--summary', 'beta done', '--branch', 'wt/e-qa', '--tests-json', fakeTests]);
const forged = await http('POST', `/api/agent/${B.id}/tasks/${T2}/result`, { token: B.token, body: { clientRequestId: 'forge-1', status: 'integrated', summary: 'forge', branch: 'wt/e-qa' } });
const forgedPatch = await http('PATCH', `/api/tasks/${T2}`, { token: B.token, body: { status: 'integrated' } });
const ownerNoVerif = await http('PATCH', `/api/tasks/${T2}`, { token: OWNER, body: { status: 'integrated' } });
st = await state();
const t2s = st.tasks.find((t) => t.id === T2)?.status;
check('report_task_result completed -> ready_for_review; status integrated rejected (400); agent PATCH -> 401; owner integrated without verification rejected', resB.code === 0 && t2s === 'ready_for_review' && forged.status === 400 && forgedPatch.status === 401 && ownerNoVerif.status !== 200, `task=${t2s} forged=${forged.status} agentPatch=${forgedPatch.status} ownerNoVerif=${ownerNoVerif.status} ${ownerNoVerif.body?.error?.code}`);
const dupRes = agent(B, ['result', '--task', T2, '--status', 'completed', '--summary', 'beta done again', '--branch', 'wt/e-qa', '--client-id', resB.json?.result?.clientRequestId ?? 'none']);
check('report_task_result with the same clientRequestId is a duplicate (no second result)', dupRes.code === 0 && dupRes.json?.duplicate === true, `duplicate=${dupRes.json?.duplicate}`);

// 14. redaction
agent(A, ['log', '--message', 'token sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 and ghp_abcdefghijklmnopqrstuvwxyz0123456789 and Bearer abcdefghijklmnop']);
const evs = await readSse(`/api/stream?runId=${run.id}&after=0`, 1200);
const last = evs.filter((f) => f.event === 'agent.log').map((f) => JSON.parse(f.data)).at(-1);
const msg = last?.payload?.message ?? '';
check('secret-looking strings in agent messages are redacted in stored events', !/sk-ant-api03-ABCDEFG|ghp_abcdefgh|Bearer abcdefgh/.test(msg), JSON.stringify(msg).slice(0, 160));

// 15. snapshot for restart comparison
st = await state();
if (SNAPSHOT) {
  const pre = await readSse(`/api/stream?runId=${run.id}&after=0`, 1500);
  fs.writeFileSync(SNAPSHOT, JSON.stringify({ ...st, _qaAgents: { A, B }, _qaTasks: { T1, T2 }, _qaEventCount: pre.filter((f) => f.id !== undefined).length }, null, 2));
  console.log(`snapshot written to ${SNAPSHOT} (run ${run.id})`);
}
finish();
