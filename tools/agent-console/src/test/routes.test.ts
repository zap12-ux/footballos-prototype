import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ask, makeHarness, seed, type Harness } from './helpers.js';

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.close());

describe('auth', () => {
  it('rejects missing, wrong, and agent tokens on owner routes with 401 envelope', async () => {
    const s = await seed(h);
    expect((await h.agent('', 'GET', '/api/state')).status).toBe(401);
    const wrong = await h.agent('x'.repeat(64), 'GET', '/api/state');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual({ error: { code: 'unauthorized', message: 'unauthorized' } });
    expect((await h.agent(s.tok1, 'GET', '/api/state')).status).toBe(401);
  });

  it('rejects disallowed Origin with 401 and accepts the allow-list', async () => {
    const bad = await h.owner('GET', '/api/runs', undefined, { origin: 'http://evil.example' });
    expect(bad.status).toBe(401);
    const ok = await h.owner('GET', '/api/runs', undefined, { origin: 'http://localhost:4801' });
    expect(ok.status).toBe(200);
  });

  it('agent token for another agent id gives 404, owner token on agent routes gives 401', async () => {
    const s = await seed(h);
    const cross = await h.agent(s.tok1, 'POST', `/api/agent/${s.a2.id}/log`, { clientEventId: 'e1', message: 'hi' });
    expect(cross.status).toBe(404);
    const ownerOnAgent = await h.owner('POST', `/api/agent/${s.a1.id}/log`, { clientEventId: 'e1', message: 'hi' });
    expect(ownerOnAgent.status).toBe(401);
  });

  it('agent registration returns the token once and never exposes hashes in state', async () => {
    const s = await seed(h);
    expect(s.tok1).toMatch(/^[0-9a-f]{64}$/);
    const state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(JSON.stringify(state.body)).not.toContain('token');
  });
});

describe('questions and responses', () => {
  it('idempotent submit, 409 on a second clientRequestId, version mismatch 409', async () => {
    const s = await seed(h);
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    expect(q.questionVersion).toBe(1);
    const first = await h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' });
    expect(first.status).toBe(201);
    const again = await h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' });
    expect(again.status).toBe(200);
    expect(again.body.response.id).toBe(first.body.response.id);
    const second = await h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r2', questionVersion: 1, option: 'b' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('conflict');
    const q2 = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const stale = await h.owner('POST', `/api/questions/${q2.id}/responses`, { clientRequestId: 'r3', questionVersion: 2, option: 'a' });
    expect(stale.status).toBe(409);
    const badOpt = await h.owner('POST', `/api/questions/${q2.id}/responses`, { clientRequestId: 'r4', questionVersion: 1, option: 'zzz' });
    expect(badOpt.status).toBe(400);
  });

  it('asking with the same clientRequestId is idempotent; revised content bumps the version', async () => {
    const s = await seed(h);
    const a = (await ask(h, s.tok1, s.a1.id, s.t1.id, { clientRequestId: 'q-1' })).body.question;
    const b = await ask(h, s.tok1, s.a1.id, s.t1.id, { clientRequestId: 'q-1' });
    expect(b.status).toBe(200);
    expect(b.body.question.id).toBe(a.id);
    const c = await ask(h, s.tok1, s.a1.id, s.t1.id, { clientRequestId: 'q-1', question: 'Revised?' });
    expect(c.body.question.questionVersion).toBe(2);
    const stale = await h.owner('POST', `/api/questions/${a.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' });
    expect(stale.status).toBe(409);
  });

  it('delivers an answer only to its own agent and marks delivered once via agent_poll', async () => {
    const s = await seed(h);
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const none = await h.agent(s.tok1, 'GET', `/api/agent/${s.a1.id}/questions/${q.id}/response`);
    expect(none.status).toBe(204);
    await h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' });
    const other = await h.agent(s.tok2, 'GET', `/api/agent/${s.a2.id}/questions/${q.id}/response`);
    expect(other.status).toBe(404);
    const got = await h.agent(s.tok1, 'GET', `/api/agent/${s.a1.id}/questions/${q.id}/response`);
    expect(got.status).toBe(200);
    expect(got.body.response.state).toBe('delivered');
    expect(got.body.response.deliveredVia).toBe('agent_poll');
    expect(got.body.question.id).toBe(q.id);
    const deliveredAt = got.body.response.deliveredAt;
    const again = await h.agent(s.tok1, 'GET', `/api/agent/${s.a1.id}/questions/${q.id}/response`);
    expect(again.body.response.deliveredAt).toBe(deliveredAt);
    const events = h.service.eventsAfter(s.run.id, 0).filter((e) => e.type === 'response.delivered');
    expect(events).toHaveLength(1);
  });

  it('ack is idempotent and resumedAfterAck flips after a later status', async () => {
    const s = await seed(h);
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const r = (await h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' })).body.response;
    await h.agent(s.tok1, 'GET', `/api/agent/${s.a1.id}/questions/${q.id}/response`);
    const ack = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/questions/${q.id}/ack`, { responseId: r.id, note: 'got it' });
    expect(ack.status).toBe(200);
    expect(ack.body.response.state).toBe('acknowledged');
    expect(ack.body.changed).toBe(true);
    const ack2 = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/questions/${q.id}/ack`, { responseId: r.id });
    expect(ack2.body.changed).toBe(false);
    let state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(state.body.responses[0].resumedAfterAck).toBe(false);
    // Another agent's activity must not count.
    await h.agent(s.tok2, 'POST', `/api/agent/${s.a2.id}/status`, { clientEventId: 'b1', state: 'working', message: 'x' });
    state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(state.body.responses[0].resumedAfterAck).toBe(false);
    await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/status`, { clientEventId: 'a1', state: 'working', message: 'continuing' });
    state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(state.body.responses[0].resumedAfterAck).toBe(true);
  });

  it('lead continuation: message.delivered sets delivered via lead_continuation; ack still needs the agent', async () => {
    const s = await seed(h);
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const r = (await h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, text: 'use b' })).body.response;
    const ev = await h.owner('POST', '/api/runtime/events', { type: 'message.delivered', responseId: r.id, details: { how: 'SendMessage' } });
    expect(ev.status).toBe(201);
    let state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(state.body.responses[0].state).toBe('delivered');
    expect(state.body.responses[0].deliveredVia).toBe('lead_continuation');
    const ack = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/questions/${q.id}/ack`, { responseId: r.id });
    expect(ack.body.response.state).toBe('acknowledged');
    state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(state.body.responses[0].deliveredVia).toBe('lead_continuation');
  });

  it('superseded question returns 410 to the agent and the old question is marked', async () => {
    const s = await seed(h);
    const q1 = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const q2 = (await ask(h, s.tok1, s.a1.id, s.t1.id, { supersedesQuestionId: q1.id })).body.question;
    expect(q2.supersedesQuestionId).toBe(q1.id);
    const r = await h.agent(s.tok1, 'GET', `/api/agent/${s.a1.id}/questions/${q1.id}/response`);
    expect(r.status).toBe(410);
    expect(r.body.error.code).toBe('gone');
    const open = await h.owner('GET', `/api/questions?runId=${s.run.id}&status=open`);
    expect(open.body.questions.map((q: any) => q.id)).toEqual([q2.id]);
    const answer = await h.owner('POST', `/api/questions/${q1.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' });
    expect(answer.status).toBe(409);
  });

  it('question on an integrated task is expired and 410 to the agent', async () => {
    const s = await seed(h);
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const v = (await h.owner('POST', '/api/verifications', { taskId: s.t1.id, kind: 'tests', resultSummary: 'ok', passed: true, evidence: {} })).body.verification;
    const patched = await h.owner('PATCH', `/api/tasks/${s.t1.id}`, { status: 'integrated', verificationId: v.id });
    expect(patched.status).toBe(200);
    const r = await h.agent(s.tok1, 'GET', `/api/agent/${s.a1.id}/questions/${q.id}/response`);
    expect(r.status).toBe(410);
    const state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(state.body.questions[0].status).toBe('expired');
  });
});

describe('tasks, results, verifications', () => {
  it('report_task_result sets ready_for_review, is idempotent, and never integrates', async () => {
    const s = await seed(h);
    const body = {
      clientRequestId: 'res-1',
      status: 'completed',
      summary: 'done',
      branch: 'wt/a',
      commit: 'abc',
      changedFiles: ['x.ts'],
      testsRun: [{ command: 'npm test', passed: true, summary: '3 passed' }],
      limitations: [],
      followUps: [],
    };
    const r = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/tasks/${s.t1.id}/result`, body);
    expect(r.status).toBe(201);
    expect(r.body.task.status).toBe('ready_for_review');
    const dup = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/tasks/${s.t1.id}/result`, body);
    expect(dup.status).toBe(200);
    expect(dup.body.duplicate).toBe(true);
    const bad = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/tasks/${s.t1.id}/result`, { ...body, clientRequestId: 'res-2', status: 'integrated' });
    expect(bad.status).toBe(400);
    const state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(state.body.tasks.find((t: any) => t.id === s.t1.id).status).toBe('ready_for_review');
    expect(state.body.taskResults).toHaveLength(1);
    // Another agent cannot report on this task.
    const cross = await h.agent(s.tok2, 'POST', `/api/agent/${s.a2.id}/tasks/${s.t1.id}/result`, { ...body, clientRequestId: 'res-3' });
    expect(cross.status).toBe(404);
  });

  it('integrated/verified require a verificationId for the same task', async () => {
    const s = await seed(h);
    const noV = await h.owner('PATCH', `/api/tasks/${s.t1.id}`, { status: 'integrated' });
    expect(noV.status).toBe(400);
    const v = (await h.owner('POST', '/api/verifications', { taskId: s.t2.id, kind: 'manual', resultSummary: 'ok', passed: true, evidence: {} })).body.verification;
    const wrongTask = await h.owner('PATCH', `/api/tasks/${s.t1.id}`, { status: 'verified', verificationId: v.id });
    expect(wrongTask.status).toBe(400);
    const ok = await h.owner('PATCH', `/api/tasks/${s.t2.id}`, { status: 'verified', verificationId: v.id });
    expect(ok.status).toBe(200);
    expect(ok.body.task.status).toBe('verified');
  });

  it('status report moves a ready task to in_progress and duplicates are no-ops', async () => {
    const s = await seed(h);
    const r1 = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/status`, { clientEventId: 'e1', state: 'working', taskId: s.t1.id, message: 'go' });
    expect(r1.status).toBe(200);
    expect(r1.body.duplicate).toBe(false);
    const r2 = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/status`, { clientEventId: 'e1', state: 'idle', taskId: s.t1.id, message: 'ignored' });
    expect(r2.body.duplicate).toBe(true);
    const state = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(state.body.tasks[0].status).toBe('in_progress');
    expect(state.body.agents[0].selfState).toBe('working');
    expect(state.body.agents[0].execState).toBe('working');
    expect(h.service.eventsAfter(s.run.id, 0).filter((e) => e.type === 'agent.status')).toHaveLength(1);
  });
});

describe('derived execState', () => {
  it('waiting_for_you from blocking questions, completed/failed only from runtime events, disconnected from staleness', async () => {
    const s = await seed(h);
    await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/status`, { clientEventId: 'e1', state: 'working', message: 'go' });
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id, { blocking: true })).body.question;
    let agents = (await h.owner('GET', `/api/state?runId=${s.run.id}`)).body.agents;
    expect(agents[0].execState).toBe('waiting_for_you');
    expect(agents[0].selfState).toBe('working');
    await h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' });
    agents = (await h.owner('GET', `/api/state?runId=${s.run.id}`)).body.agents;
    expect(agents[0].execState).toBe('working');
    // Non-blocking question does not change state.
    await ask(h, s.tok1, s.a1.id, s.t1.id, { blocking: false });
    agents = (await h.owner('GET', `/api/state?runId=${s.run.id}`)).body.agents;
    expect(agents[0].execState).toBe('working');
    // Self-report cannot produce completed.
    const bad = await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/status`, { clientEventId: 'e2', state: 'completed', message: 'x' });
    expect(bad.status).toBe(400);
    await h.owner('POST', '/api/runtime/events', { type: 'agent.completed', agentId: s.a1.id, details: {} });
    agents = (await h.owner('GET', `/api/state?runId=${s.run.id}`)).body.agents;
    expect(agents[0].execState).toBe('completed');
    await h.owner('POST', '/api/runtime/events', { type: 'agent.resumed', agentId: s.a1.id, details: {} });
    agents = (await h.owner('GET', `/api/state?runId=${s.run.id}`)).body.agents;
    expect(agents[0].execState).toBe('working');
    await h.owner('POST', '/api/runtime/events', { type: 'agent.failed', agentId: s.a2.id, details: { reason: 'crash' } });
    agents = (await h.owner('GET', `/api/state?runId=${s.run.id}`)).body.agents;
    expect(agents[1].execState).toBe('failed');
  });

  it('becomes disconnected when stale while working, not when idle', async () => {
    const s = await seed(h);
    await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/status`, { clientEventId: 'e1', state: 'working', message: 'go' });
    await h.agent(s.tok2, 'POST', `/api/agent/${s.a2.id}/status`, { clientEventId: 'e1', state: 'idle', message: 'zzz' });
    const old = new Date(Date.now() - 25 * 60_000).toISOString();
    h.service.db.prepare('UPDATE agents SET last_agent_update_at = ?').run(old);
    const agents = (await h.owner('GET', `/api/state?runId=${s.run.id}`)).body.agents;
    expect(agents[0].execState).toBe('disconnected');
    expect(agents[0].selfState).toBe('working');
    expect(agents[1].execState).toBe('idle');
  });
});

describe('lead inbox and redaction', () => {
  it('lists submitted responses older than the pickup window that no agent fetched', async () => {
    h.close();
    h = makeHarness({ leadPickupAfterSec: 0 });
    const s = await seed(h);
    const q1 = (await ask(h, s.tok1, s.a1.id, s.t1.id)).body.question;
    const q2 = (await ask(h, s.tok2, s.a2.id, s.t2.id)).body.question;
    await h.owner('POST', `/api/questions/${q1.id}/responses`, { clientRequestId: 'r1', questionVersion: 1, option: 'a' });
    await h.owner('POST', `/api/questions/${q2.id}/responses`, { clientRequestId: 'r2', questionVersion: 1, option: 'b' });
    await h.agent(s.tok2, 'GET', `/api/agent/${s.a2.id}/questions/${q2.id}/response`);
    const inbox = await h.owner('GET', `/api/lead/inbox?runId=${s.run.id}`);
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0].question.id).toBe(q1.id);
    expect(inbox.body.items[0].agent.id).toBe(s.a1.id);
  });

  it('redacts secrets in stored free text and events', async () => {
    const s = await seed(h);
    await h.agent(s.tok1, 'POST', `/api/agent/${s.a1.id}/log`, { clientEventId: 'l1', message: 'key sk-abcdefghijklmnop and ghp_ABCDEFGHIJKLMNOP and Bearer abcdefghijklmnop and AKIAABCDEFGHIJKLMNOP' });
    const q = (await ask(h, s.tok1, s.a1.id, s.t1.id, { question: 'Use sk-secretsecret123?' })).body.question;
    expect(q.question).toBe('Use [redacted]?');
    const events = h.service.eventsAfter(s.run.id, 0);
    const log = events.find((e) => e.type === 'agent.log')!;
    expect(log.payload.message).toBe('key [redacted] and [redacted] and [redacted] and [redacted]');
    expect(JSON.stringify(events)).not.toContain('sk-');
  });

  it('state defaults to the latest live run and labels fixtures', async () => {
    const s = await seed(h);
    const live = (await h.owner('POST', '/api/runs', { kind: 'live', label: 'live-1' })).body.run;
    const state = await h.owner('GET', '/api/state');
    expect(state.body.run.id).toBe(live.id);
    expect(state.body.run.fixture).toBe(false);
    const fx = await h.owner('GET', `/api/state?runId=${s.run.id}`);
    expect(fx.body.run.fixture).toBe(true);
    expect(fx.body.run.kind).toBe('fixture');
  });

  it('validation errors use the envelope', async () => {
    const r = await h.owner('POST', '/api/runs', { kind: 'nope' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
    const nf = await h.owner('GET', '/api/git/agents/does-not-exist');
    expect(nf.status).toBe(404);
    const unknownApi = await h.owner('GET', '/api/nope');
    expect(unknownApi.status).toBe(404);
    expect(unknownApi.body.error.code).toBe('not_found');
    const root = await h.raw('GET', '/');
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('UI is not built');
  });
});
