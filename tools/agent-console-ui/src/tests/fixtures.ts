import type { Agent, ConsoleEvent, Question, QuestionResponse, StateSnapshot, Task, Verification } from '../types';

export const RUN = '22222222-2222-4222-8222-222222222222';
export const LEAD = 'a0000000-0000-4000-8000-000000000001';
export const FE = 'a0000000-0000-4000-8000-000000000002';
export const BE1 = 'a0000000-0000-4000-8000-000000000003';
export const BE2 = 'a0000000-0000-4000-8000-000000000004';
export const Q1 = 'c0000000-0000-4000-8000-000000000001';
export const Q2 = 'c0000000-0000-4000-8000-000000000002';
export const NOW = '2026-10-25T12:00:00.000Z';

export function agent(over: Partial<Agent> & { id: string; name: string; role: string }): Agent {
  return { runId: RUN, createdAt: '2026-10-25T11:00:00.000Z', updatedAt: '2026-10-25T11:50:00.000Z', execState: 'working', lastUpdateAt: '2026-10-25T11:55:00.000Z', ...over };
}

export function task(over: Partial<Task> & { id: string; title: string }): Task {
  return { runId: RUN, objective: `Objective of ${over.id}`, acceptanceCriteria: ['AC 1'], dependsOn: [], allowedPaths: [], status: 'in_progress', createdAt: '2026-10-25T11:00:00.000Z', ...over };
}

export function question(over: Partial<Question> & { id: string; agentId: string; taskId: string }): Question {
  return {
    runId: RUN,
    questionVersion: 1,
    question: `Question ${over.id.slice(-1)}?`,
    why: 'Because.',
    options: ['Alpha', 'Beta'],
    recommendation: 'Alpha',
    blocking: false,
    status: 'open',
    createdAt: '2026-10-25T11:40:00.000Z',
    updatedAt: '2026-10-25T11:40:00.000Z',
    ...over,
  };
}

export function response(over: Partial<QuestionResponse> & { id: string; questionId: string; agentId: string }): QuestionResponse {
  return { runId: RUN, taskId: 'T', questionVersion: 1, state: 'submitted', createdAt: '2026-10-25T11:45:00.000Z', updatedAt: '2026-10-25T11:45:00.000Z', ...over };
}

export function verification(over: Partial<Verification> & { id: string; taskId: string }): Verification {
  return { kind: 'tests', resultSummary: 'ok', passed: true, evidence: {}, createdAt: '2026-10-25T11:50:00.000Z', ...over };
}

export function snapshot(over: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    run: { id: RUN, kind: 'fixture', label: 'FIXTURE test', createdAt: '2026-10-25T10:00:00.000Z' },
    agents: [
      agent({ id: LEAD, name: 'lead', role: 'Lead / Integrator' }),
      agent({ id: FE, name: 'console-ui', role: 'Product Design / Frontend' }),
      agent({ id: BE1, name: 'runtime', role: 'Backend / Team Platform' }),
      agent({ id: BE2, name: 'platform-2', role: 'Backend / Team Platform', createdAt: '2026-10-25T11:10:00.000Z', execState: 'waiting_on_dependency', blockedByTaskId: 'B1', lastUpdateAt: '2026-10-25T11:20:00.000Z' }),
    ],
    tasks: [
      task({ id: 'L1', title: 'Coordinate', agentId: LEAD, dependsOn: ['F1'] }),
      task({ id: 'F1', title: 'Build UI', agentId: FE, dependsOn: ['B1'] }),
      task({ id: 'B1', title: 'Build runtime', agentId: BE1 }),
      task({ id: 'B2', title: 'Schema', agentId: BE2, dependsOn: ['B1'], status: 'blocked' }),
    ],
    questions: [question({ id: Q1, agentId: FE, taskId: 'F1', blocking: true }), question({ id: Q2, agentId: BE1, taskId: 'B1', createdAt: '2026-10-25T11:30:00.000Z' })],
    responses: [],
    verifications: [],
    lastRuntimeEventAt: '2026-10-25T11:58:00.000Z',
    serverTime: NOW,
    lastSeq: 10,
    ...over,
  };
}

let seq = 100;
export function event(over: Partial<ConsoleEvent> & { type: string }): ConsoleEvent {
  seq += 1;
  return { id: `ev-${seq}-${Math.random().toString(36).slice(2, 8)}`, seq, runId: RUN, ts: NOW, source: 'agent', payload: {}, ...over };
}
