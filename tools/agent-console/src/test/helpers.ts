import { serve } from '@hono/node-server';
import { createApp } from '../app.js';
import { openDb } from '../db.js';
import { Service } from '../service.js';
import { Store } from '../store.js';

export const OWNER = 'o'.repeat(64);

export interface Harness {
  service: Service;
  app: ReturnType<typeof createApp>;
  owner<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
  agent<T = any>(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: T }>;
  raw(method: string, path: string, init?: RequestInit): Promise<Response>;
  close(): void;
}

export function makeHarness(opts: { staleAfterMin?: number; leadPickupAfterSec?: number; heartbeatMs?: number } = {}): Harness {
  const db = openDb(':memory:');
  const service = new Service(new Store(db), {
    staleAfterMin: opts.staleAfterMin ?? 20,
    leadPickupAfterSec: opts.leadPickupAfterSec ?? 90,
  });
  const app = createApp({
    service,
    ownerToken: OWNER,
    port: 4800,
    repoRoot: process.cwd(),
    uiDist: '/nonexistent/ui-dist',
    heartbeatMs: opts.heartbeatMs,
  });
  const call = async (token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  };
  return {
    service,
    app,
    owner: (m, p, b, h) => call(OWNER, m, p, b, h),
    agent: (t, m, p, b) => call(t, m, p, b),
    raw: (m, p, init) => app.request(p, { method: m, ...init }),
    close: () => db.close(),
  };
}

/** Standard fixture: one run, two agents, two tasks. */
export async function seed(h: Harness) {
  const run = (await h.owner('POST', '/api/runs', { kind: 'fixture', label: 'test' })).body.run;
  const a1 = (await h.owner('POST', '/api/agents', { runId: run.id, name: 'Alpha', role: 'frontend', branch: 'wt/a' })).body;
  const a2 = (await h.owner('POST', '/api/agents', { runId: run.id, name: 'Beta', role: 'backend', branch: 'wt/b' })).body;
  const t1 = (await h.owner('POST', '/api/tasks', { runId: run.id, id: 'T1', title: 'Task one', objective: 'do one', agentId: a1.agent.id })).body.task;
  const t2 = (await h.owner('POST', '/api/tasks', { runId: run.id, id: 'T2', title: 'Task two', objective: 'do two', agentId: a2.agent.id })).body.task;
  return { run, a1: a1.agent, tok1: a1.agentToken as string, a2: a2.agent, tok2: a2.agentToken as string, t1, t2 };
}

export async function ask(h: Harness, token: string, agentId: string, taskId: string, extra: Record<string, unknown> = {}) {
  const r = await h.agent(token, 'POST', `/api/agent/${agentId}/questions`, {
    clientRequestId: extra.clientRequestId ?? crypto.randomUUID(),
    taskId,
    question: 'Which option?',
    why: 'Need to decide',
    options: ['a', 'b'],
    recommendation: 'a',
    blocking: true,
    ...extra,
  });
  return r;
}

/** Serve the app on a random port for SSE / long-poll tests. */
export function listen(h: Harness): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv = serve({ fetch: h.app.fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        close: () =>
          new Promise<void>((r) => {
            srv.close(() => r());
            (srv as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
          }),
      });
    });
  });
}
