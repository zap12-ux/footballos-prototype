// Drives bin/leadctl.mjs as a child process against a real listening server (QA defect D-1:
// single-word commands with a positional argument, `answer <qid>` and `git <agentId>`, used to
// fail with `unknown command "answer <qid>"`).
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, listen, makeHarness, OWNER, seed, type Harness } from './helpers.js';

const leadctl = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'leadctl.mjs');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  json: any;
}

function runLeadctl(url: string, args: string[], extraEnv: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [leadctl, ...args],
      { env: { ...process.env, CONSOLE_URL: url, CONSOLE_OWNER_TOKEN: OWNER, CONSOLE_DATA_DIR: '/nonexistent/k5', ...extraEnv }, timeout: 15_000 },
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
}

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

describe('leadctl dispatch (D-1)', () => {
  it('answer <questionId> --version --option reaches the owner route and the agent receives it', async () => {
    const q = (await ask(h, fx.tok1, fx.a1.id, fx.t1.id)).body.question;
    const res = await runLeadctl(srv.url, ['answer', q.id, '--version', '1', '--option', 'a']);
    expect(res.stderr).toBe('');
    expect(res.code).toBe(0);
    expect(res.json?.response).toMatchObject({ questionId: q.id, option: 'a', state: 'submitted' });
    // the agent's own fetch sees the answer
    const got = await h.agent(fx.tok1, 'GET', `/api/agent/${fx.a1.id}/questions/${q.id}/response?wait=0`);
    expect(got.status).toBe(200);
    expect(got.body.response.id).toBe(res.json.response.id);
  });

  it('answer with --text and an explicit --client-id is idempotent', async () => {
    const q = (await ask(h, fx.tok2, fx.a2.id, fx.t2.id)).body.question;
    const first = await runLeadctl(srv.url, ['answer', q.id, '--version', '1', '--text', 'go with b', '--client-id', 'cli-1']);
    const again = await runLeadctl(srv.url, ['answer', q.id, '--version', '1', '--text', 'go with b', '--client-id', 'cli-1']);
    expect(first.code).toBe(0);
    expect(again.code).toBe(0);
    expect(again.json.response.id).toBe(first.json.response.id);
  });

  it('answer without a questionId fails with usage, not "unknown command"', async () => {
    const res = await runLeadctl(srv.url, ['answer', '--version', '1', '--option', 'a']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('questionId is required');
    expect(res.stderr).not.toContain('unknown command');
  });

  it('git <agentId> returns the git corroboration payload', async () => {
    const res = await runLeadctl(srv.url, ['git', fx.a1.id]);
    expect(res.stderr).toBe('');
    expect(res.code).toBe(0);
    expect(res.json).toMatchObject({ branch: 'wt/a' });
    expect(typeof res.json.exists).toBe('boolean');
    expect(Array.isArray(res.json.commits)).toBe(true);
  });

  it('two-word commands still dispatch (agent set, task set, run create) and unknown commands fail', async () => {
    const set = await runLeadctl(srv.url, ['agent', 'set', fx.a1.id, '--branch', 'wt/a-renamed']);
    expect(set.code).toBe(0);
    expect(set.json.agent.branch).toBe('wt/a-renamed');
    const task = await runLeadctl(srv.url, ['task', 'set', fx.t2.id, '--status', 'blocked']);
    expect(task.code).toBe(0);
    expect(task.json.task.status).toBe('blocked');
    const run = await runLeadctl(srv.url, ['run', 'create', '--kind', 'fixture', '--label', 'second']);
    expect(run.code).toBe(0);
    expect(run.json.run.kind).toBe('fixture');
    const runs = await runLeadctl(srv.url, ['runs']);
    expect(runs.code).toBe(0);
    expect(runs.json.runs.length).toBe(2);
    const bogus = await runLeadctl(srv.url, ['frobnicate', 'x']);
    expect(bogus.code).toBe(1);
    expect(bogus.stderr).toContain('unknown command "frobnicate x"');
    const bogusSub = await runLeadctl(srv.url, ['task', 'frobnicate']);
    expect(bogusSub.code).toBe(1);
    expect(bogusSub.stderr).toContain('unknown command');
  });
});
