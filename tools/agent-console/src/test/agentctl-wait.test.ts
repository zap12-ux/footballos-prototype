// Drives bin/agentctl.mjs `wait --poll-until-answered` against a real listening server.
import { execFile, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, listen, makeHarness, seed, type Harness } from './helpers.js';

const agentctl = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'agentctl.mjs');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  json: any;
}

function runAgentctl(url: string, agent: { id: string; token: string }, args: string[], env: Record<string, string> = {}): { child: ChildProcess; done: Promise<CliResult> } {
  let child!: ChildProcess;
  const done = new Promise<CliResult>((resolve) => {
    child = execFile(
      process.execPath,
      [agentctl, ...args],
      { env: { ...process.env, CONSOLE_URL: url, CONSOLE_AGENT_ID: agent.id, CONSOLE_AGENT_TOKEN: agent.token, ...env }, timeout: 15_000 },
      (err, stdout, stderr) => {
        let json: any = null;
        try {
          json = stdout ? JSON.parse(stdout) : null;
        } catch {
          json = null;
        }
        resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code as number) : 1) : 0, stdout, stderr, json });
      },
    );
  });
  return { child, done };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let h: Harness;
let srv: { url: string; close: () => Promise<void> };
let fx: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  h = makeHarness();
  srv = await listen(h);
  fx = await seed(h);
});
afterAll(async () => {
  await srv.close();
  h.close();
});

describe('agentctl wait --poll-until-answered', () => {
  it('keeps polling with heartbeats on stderr until the owner answers, then prints the answer and acks', async () => {
    const q = (await ask(h, fx.tok1, fx.a1.id, fx.t1.id)).body.question;
    const A = { id: fx.a1.id, token: fx.tok1 };
    const { done } = runAgentctl(srv.url, A, ['wait', q.id, '--poll-until-answered', '--ack'], { AGENTCTL_HEARTBEAT_MS: '100' });
    await sleep(1500); // node startup under parallel test load can take ~500 ms; leaves many 100 ms heartbeats
    const r = (await h.agent(fx.tok1, 'GET', `/api/agent/${fx.a1.id}/questions/${q.id}/response?wait=0`)).status;
    expect(r).toBe(204); // still unanswered: the CLI is really waiting
    await h.owner('POST', `/api/questions/${q.id}/responses`, { clientRequestId: 'w-1', questionVersion: 1, option: 'b' });
    const out = await done;
    expect(out.code).toBe(0);
    expect(out.json?.response).toMatchObject({ questionId: q.id, option: 'b', state: 'acknowledged' });
    expect(out.json?.acknowledged).toBe(true);
    const heartbeats = out.stderr.split('\n').filter((l) => l.startsWith('heartbeat: still waiting for an answer to ' + q.id));
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);
    expect(heartbeats[0]).toMatch(/\(\d+ min elapsed\)$/);
    // stdout stays pure JSON (heartbeats go to stderr)
    expect(() => JSON.parse(out.stdout)).not.toThrow();
  });

  it('exits 3 when the question is superseded while polling', async () => {
    const q = (await ask(h, fx.tok2, fx.a2.id, fx.t2.id)).body.question;
    const B = { id: fx.a2.id, token: fx.tok2 };
    const { done } = runAgentctl(srv.url, B, ['wait', q.id, '--poll-until-answered']);
    await sleep(400);
    await ask(h, fx.tok2, fx.a2.id, fx.t2.id, { supersedesQuestionId: q.id, question: 'Replacement?' });
    const out = await done;
    expect(out.code).toBe(3);
    expect(out.stderr).toContain('410 gone');
  });

  it('rejects --poll-until-answered combined with --timeout', async () => {
    const out = await runAgentctl(srv.url, { id: fx.a1.id, token: fx.tok1 }, ['wait', 'x', '--poll-until-answered', '--timeout', '5']).done;
    expect(out.code).toBe(1);
    expect(out.stderr).toContain('mutually exclusive');
  });

  it('bounded wait still times out with exit 4', async () => {
    const q = (await ask(h, fx.tok1, fx.a1.id, fx.t1.id)).body.question;
    const out = await runAgentctl(srv.url, { id: fx.a1.id, token: fx.tok1 }, ['wait', q.id, '--timeout', '1']).done;
    expect(out.code).toBe(4);
    expect(out.stderr).toContain('timed out after 1s');
  });
});
