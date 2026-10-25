import { describe, expect, it } from 'vitest';
import { applyEvent, applyEvents, initialState, loadSnapshot } from '../lib/store';
import { responseStateLabel } from '../lib/derive';
import { BE1, event, FE, Q1, response, snapshot } from './fixtures';

describe('store', () => {
  it('treats replayed events at or below the snapshot lastSeq as history only', () => {
    let s = loadSnapshot(initialState(), snapshot({ lastSeq: 10 }));
    s = applyEvent(s, event({ seq: 9, type: 'agent.status', agentId: FE, payload: { state: 'idle', message: 'old' } }));
    expect(s.events).toHaveLength(1);
    expect(s.snapshot!.agents.find((a) => a.id === FE)!.execState).toBe('working');
    s = applyEvent(s, event({ seq: 11, type: 'agent.status', agentId: FE, payload: { state: 'idle', message: 'new' } }));
    expect(s.snapshot!.agents.find((a) => a.id === FE)!).toMatchObject({ execState: 'idle', lastMessage: 'new' });
    expect(s.appliedSeq).toBe(11);
  });

  it('ignores duplicate event ids and keeps history sorted by seq', () => {
    let s = loadSnapshot(initialState(), snapshot({ lastSeq: 0 }));
    const a = event({ seq: 5, type: 'agent.log', agentId: FE, payload: { message: 'a' } });
    const b = event({ seq: 3, type: 'agent.log', agentId: FE, payload: { message: 'b' } });
    s = applyEvents(s, [a, b, a]);
    expect(s.events.map((e) => e.seq)).toEqual([3, 5]);
  });

  it('never lets a self-report set completed/failed, but runtime events do', () => {
    let s = loadSnapshot(initialState(), snapshot({ lastSeq: 0 }));
    s = applyEvent(s, event({ seq: 1, type: 'agent.status', agentId: FE, payload: { state: 'completed' } }));
    expect(s.snapshot!.agents.find((a) => a.id === FE)!.execState).toBe('working');
    s = applyEvent(s, event({ seq: 2, type: 'agent.failed', agentId: FE, source: 'runtime', payload: { error: 'boom' } }));
    expect(s.snapshot!.agents.find((a) => a.id === FE)!).toMatchObject({ execState: 'failed', lastMessage: 'boom' });
    expect(s.snapshot!.lastRuntimeEventAt).toBe(s.events[1].ts);
  });

  it('walks the response lifecycle and marks Resumed only after an agent update follows acknowledgement', () => {
    let s = loadSnapshot(initialState(), snapshot({ lastSeq: 0 }));
    const r = response({ id: 'R1', questionId: Q1, agentId: FE, taskId: 'F1', option: 'Alpha' });
    s = applyEvent(s, event({ seq: 1, type: 'response.submitted', agentId: FE, questionId: Q1, responseId: 'R1', source: 'owner', payload: { response: r } }));
    expect(s.snapshot!.questions.find((q) => q.id === Q1)!.status).toBe('answered');
    expect(responseStateLabel(s.snapshot!.responses[0])).toBe('Submitted');
    s = applyEvent(s, event({ seq: 2, type: 'response.delivered', agentId: FE, questionId: Q1, responseId: 'R1', source: 'system', payload: { via: 'agent_poll' }, ts: '2026-10-25T12:01:00.000Z' }));
    expect(s.snapshot!.responses[0]).toMatchObject({ state: 'delivered', via: 'agent_poll' });
    expect(responseStateLabel(s.snapshot!.responses[0])).toBe('Delivered');
    // a log before acknowledgement must not count as resumed
    s = applyEvent(s, event({ seq: 3, type: 'agent.log', agentId: FE, payload: { message: 'still reading' }, ts: '2026-10-25T12:01:30.000Z' }));
    s = applyEvent(s, event({ seq: 4, type: 'response.acknowledged', agentId: FE, questionId: Q1, responseId: 'R1', ts: '2026-10-25T12:02:00.000Z' }));
    expect(responseStateLabel(s.snapshot!.responses[0])).toBe('Acknowledged');
    expect(s.snapshot!.responses[0].resumedAfterAck).toBeFalsy();
    s = applyEvent(s, event({ seq: 5, type: 'agent.status', agentId: FE, payload: { state: 'working', message: 'continuing' }, ts: '2026-10-25T12:03:00.000Z' }));
    expect(s.snapshot!.responses[0].resumedAfterAck).toBe(true);
    expect(responseStateLabel(s.snapshot!.responses[0])).toBe('Acknowledged · Resumed');
  });

  it('message.delivered marks delivery via lead continuation; a later delivered never regresses acknowledged', () => {
    let s = loadSnapshot(initialState(), snapshot({ lastSeq: 0, responses: [response({ id: 'R1', questionId: Q1, agentId: FE, state: 'acknowledged' })] }));
    s = applyEvent(s, event({ seq: 1, type: 'message.delivered', agentId: FE, responseId: 'R1', source: 'runtime', payload: {} }));
    expect(s.snapshot!.responses[0].state).toBe('acknowledged');
    s = loadSnapshot(initialState(), snapshot({ lastSeq: 0, responses: [response({ id: 'R2', questionId: Q1, agentId: FE })] }));
    s = applyEvent(s, event({ seq: 1, type: 'message.delivered', agentId: FE, responseId: 'R2', source: 'runtime', payload: {} }));
    expect(s.snapshot!.responses[0]).toMatchObject({ state: 'delivered', via: 'lead_continuation' });
  });

  it('applies task.result, task.updated, question.asked with supersession, and verification.recorded', () => {
    let s = loadSnapshot(initialState(), snapshot({ lastSeq: 0 }));
    s = applyEvent(s, event({ seq: 1, type: 'task.result', agentId: BE1, taskId: 'B1', payload: { result: { status: 'completed', summary: 'done', changedFiles: ['a.ts'], testsRun: [{ command: 'npm test', passed: true, summary: '3 passed' }], limitations: [], followUps: [] } } }));
    const b1 = s.snapshot!.tasks.find((t) => t.id === 'B1')!;
    expect(b1.status).toBe('ready_for_review');
    expect(b1.result?.testsRun[0].command).toBe('npm test');
    s = applyEvent(s, event({ seq: 2, type: 'task.updated', taskId: 'B1', source: 'lead', payload: { task: { id: 'B1', status: 'verified', verificationId: 'V1' } } }));
    expect(s.snapshot!.tasks.find((t) => t.id === 'B1')!.status).toBe('verified');
    s = applyEvent(s, event({ seq: 3, type: 'verification.recorded', taskId: 'B1', source: 'lead', payload: { verification: { id: 'V1', taskId: 'B1', kind: 'tests', resultSummary: '3 passed', passed: true, evidence: {} } } }));
    expect(s.snapshot!.verifications).toHaveLength(1);
    s = applyEvent(s, event({ seq: 4, type: 'question.asked', agentId: FE, taskId: 'F1', questionId: 'Q9', payload: { question: { id: 'Q9', agentId: FE, taskId: 'F1', questionVersion: 1, question: 'again?', why: '', blocking: true, status: 'open', supersedesQuestionId: Q1 } } }));
    expect(s.snapshot!.questions.find((q) => q.id === Q1)!.status).toBe('superseded');
    expect(s.snapshot!.questions.find((q) => q.id === 'Q9')!.status).toBe('open');
  });

  it('guards entity patches by timestamp when the snapshot has no lastSeq', () => {
    let s = loadSnapshot(initialState(), snapshot({ lastSeq: undefined }));
    s = applyEvent(s, event({ seq: 1, type: 'agent.status', agentId: FE, ts: '2026-10-25T11:00:00.000Z', payload: { state: 'idle' } })); // older than lastUpdateAt
    expect(s.snapshot!.agents.find((a) => a.id === FE)!.execState).toBe('working');
    s = applyEvent(s, event({ seq: 2, type: 'agent.status', agentId: FE, ts: '2026-10-25T12:30:00.000Z', payload: { state: 'idle' } }));
    expect(s.snapshot!.agents.find((a) => a.id === FE)!.execState).toBe('idle');
  });
});
