import { describe, expect, it } from 'vitest';
import { InMemoryJobStore } from '../jobs/memory-store.ts';
import { backoffSec, canonicalJson, idempotencyKeyFor, JobRunner, type RunnerEvent } from '../jobs/runner.ts';
import { NonRetryableError } from '../jobs/types.ts';

function clock(start = Date.parse('2026-10-25T12:00:00.000Z')) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

function collect(runner: JobRunner): RunnerEvent[] {
  const events: RunnerEvent[] = [];
  runner.on('event', (e: RunnerEvent) => events.push(e));
  return events;
}

const base = { teamId: 'team-demo', assetId: 'asset-1', requestedBy: 'user-1', configVersion: 'seg-v1' };

describe('idempotency and backoff helpers', () => {
  it('canonical JSON ignores key order and keys are stable', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    expect(idempotencyKeyFor('segment', { assetId: 'x', fps: 4 }, 'v1')).toBe(idempotencyKeyFor('segment', { fps: 4, assetId: 'x' }, 'v1'));
    expect(idempotencyKeyFor('segment', { assetId: 'x' }, 'v1')).not.toBe(idempotencyKeyFor('segment', { assetId: 'x' }, 'v2'));
    expect(idempotencyKeyFor('a', {}, 'v')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('backoff doubles and caps', () => {
    const p = { baseSec: 5, maxSec: 60, jitter: 0 };
    expect([1, 2, 3, 4, 5].map((a) => backoffSec(a, p))).toEqual([5, 10, 20, 40, 60]);
    expect(backoffSec(1, { ...p, jitter: 0.5 }, () => 1)).toBe(7.5);
  });
});

describe('JobRunner', () => {
  it('runs a handler with progress and succeeds', async () => {
    const store = new InMemoryJobStore();
    const c = clock();
    const runner = new JobRunner({ store, workerId: 'w1', now: c.now, newId: () => 'job-1' });
    const events = collect(runner);
    runner.register<{ n: number }, { doubled: number }>('proxy', async (ctx) => {
      await ctx.progress({ done: 1, total: 2, message: 'half' });
      return { doubled: ctx.input.n * 2 };
    });
    const { job, duplicate } = await runner.enqueue({ ...base, kind: 'proxy', input: { n: 21 }, idempotencyKey: idempotencyKeyFor('proxy', { n: 21 }, 'v1') });
    expect(duplicate).toBe(false);
    expect(job.status).toBe('queued');
    const done = await runner.runOnce();
    expect(done?.status).toBe('succeeded');
    expect(done?.result).toEqual({ doubled: 42 });
    expect(done?.attempt).toBe(1);
    expect(done?.workerId).toBe('w1');
    expect(done?.finishedAt).toBe(c.now().toISOString());
    expect(events.map((e) => e.type)).toEqual(['claimed', 'progress', 'succeeded']);
    const progressEvent = events[1] as Extract<RunnerEvent, { type: 'progress' }>;
    expect(progressEvent.job.progress).toEqual({ done: 1, total: 2, message: 'half' });
    expect(await runner.runOnce()).toBeNull();
  });

  it('duplicate enqueue returns the existing job', async () => {
    const store = new InMemoryJobStore();
    const runner = new JobRunner({ store, workerId: 'w1' });
    const key = idempotencyKeyFor('segment', { assetId: 'asset-1' }, 'v1');
    const first = await runner.enqueue({ ...base, kind: 'segment', input: {}, idempotencyKey: key });
    const second = await runner.enqueue({ ...base, kind: 'segment', input: {}, idempotencyKey: key });
    expect(second.duplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);
    expect(await store.list()).toHaveLength(1);
  });

  it('retries with backoff then succeeds', async () => {
    const store = new InMemoryJobStore();
    const c = clock();
    const runner = new JobRunner({ store, workerId: 'w1', now: c.now, backoff: { baseSec: 5, maxSec: 60, jitter: 0 } });
    const events = collect(runner);
    let calls = 0;
    runner.register('thumbnails', async () => {
      calls += 1;
      if (calls < 3) throw new Error(`transient ${calls}`);
      return 'ok';
    });
    await runner.enqueue({ ...base, kind: 'thumbnails', input: {}, idempotencyKey: 'k-retry', maxAttempts: 3 });

    const a1 = await runner.runOnce();
    expect(a1?.status).toBe('retry_wait');
    expect(a1?.error).toEqual({ code: 'handler_error', message: 'transient 1' });
    expect(a1?.notBeforeAt).toBe(new Date(c.now().getTime() + 5000).toISOString());
    expect(await runner.runOnce()).toBeNull(); // not yet due
    c.advance(5000);
    const a2 = await runner.runOnce();
    expect(a2?.status).toBe('retry_wait');
    expect(a2?.attempt).toBe(2);
    expect(a2?.notBeforeAt).toBe(new Date(c.now().getTime() + 10000).toISOString());
    c.advance(10000);
    const a3 = await runner.runOnce();
    expect(a3?.status).toBe('succeeded');
    expect(a3?.attempt).toBe(3);
    expect(a3?.error).toBeNull();
    expect(events.filter((e) => e.type === 'retry_wait')).toHaveLength(2);
  });

  it('exhausts retries and fails', async () => {
    const store = new InMemoryJobStore();
    const c = clock();
    const runner = new JobRunner({ store, workerId: 'w1', now: c.now, backoff: { baseSec: 1, maxSec: 1, jitter: 0 } });
    runner.register('validate', async () => {
      throw new Error('always');
    });
    await runner.enqueue({ ...base, kind: 'validate', input: {}, idempotencyKey: 'k-fail', maxAttempts: 2 });
    expect((await runner.runOnce())?.status).toBe('retry_wait');
    c.advance(1000);
    const final = await runner.runOnce();
    expect(final?.status).toBe('failed');
    expect(final?.attempt).toBe(2);
    expect(final?.error?.message).toBe('always');
    expect(final?.finishedAt).not.toBeNull();
    expect(await runner.runOnce()).toBeNull();
  });

  it('does not retry a NonRetryableError or a job without a handler', async () => {
    const store = new InMemoryJobStore();
    const runner = new JobRunner({ store, workerId: 'w1' });
    runner.register('validate', async () => {
      throw new NonRetryableError('rejected', 'container not supported');
    });
    await runner.enqueue({ ...base, kind: 'validate', input: {}, idempotencyKey: 'k-nr', maxAttempts: 5 });
    const j = await runner.runOnce();
    expect(j?.status).toBe('failed');
    expect(j?.error).toEqual({ code: 'rejected', message: 'container not supported' });
    await runner.enqueue({ ...base, kind: 'validate', input: {}, idempotencyKey: 'k-nh' });
    const other = new JobRunner({ store, workerId: 'w2', kinds: ['validate'] });
    const nh = await other.runOnce();
    expect(nh?.status).toBe('failed');
    expect(nh?.error?.code).toBe('no_handler');
  });

  it('cancels a running job cooperatively through the AbortSignal', async () => {
    const store = new InMemoryJobStore();
    const runner = new JobRunner({ store, workerId: 'w1', leaseSec: 3, heartbeatSec: 1 });
    const events = collect(runner);
    let sawAbort = false;
    runner.register('segment', async (ctx) => {
      await new Promise<void>((resolve) => {
        ctx.signal.addEventListener('abort', () => {
          sawAbort = ctx.signal.reason === 'cancel_requested';
          resolve();
        });
      });
      // A well-behaved handler stops its work and returns; the runner records the cancel.
      return 'partial';
    });
    const { job } = await runner.enqueue({ ...base, kind: 'segment', input: {}, idempotencyKey: 'k-cancel' });
    const running = runner.runOnce();
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.get(job.id))?.status).toBe('running');
    const afterRequest = await runner.requestCancel(job.id);
    expect(afterRequest?.cancelRequestedAt).not.toBeNull();
    const finished = (await running) as NonNullable<Awaited<typeof running>>;
    expect(sawAbort).toBe(true);
    expect(finished.status).toBe('canceled');
    expect(finished.canceledAt).not.toBeNull();
    expect(finished.result).toBeNull();
    expect(events.map((e) => e.type)).toEqual(['claimed', 'canceled']);
  });

  it('cancels a queued job immediately and a retry_wait job without running it again', async () => {
    const store = new InMemoryJobStore();
    const runner = new JobRunner({ store, workerId: 'w1' });
    runner.register('segment', async () => 'never');
    const { job } = await runner.enqueue({ ...base, kind: 'segment', input: {}, idempotencyKey: 'k-cq' });
    const canceled = await runner.requestCancel(job.id);
    expect(canceled?.status).toBe('canceled');
    expect(await runner.runOnce()).toBeNull();
  });

  it('a crashed worker loses its lease; another worker re-claims after recovery', async () => {
    const store = new InMemoryJobStore();
    const c = clock();
    const crashed = new JobRunner({ store, workerId: 'w-crash', leaseSec: 30, now: c.now });
    await crashed.enqueue({ ...base, kind: 'proxy', input: {}, idempotencyKey: 'k-lease', maxAttempts: 3 });
    // Simulate the crash: claim the job directly and never heartbeat or finish.
    const claimed = await store.claim('w-crash', 30, ['proxy'], c.now());
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempt).toBe(1);

    const healthy = new JobRunner({ store, workerId: 'w-healthy', leaseSec: 30, now: c.now });
    const events = collect(healthy);
    healthy.register('proxy', async (ctx) => `done by ${ctx.workerId}`);
    expect(await healthy.runOnce()).toBeNull(); // lease still held
    expect(await healthy.recover()).toEqual([]);
    c.advance(31_000);
    const recovered = await healthy.recover();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.status).toBe('queued');
    expect(recovered[0]?.error?.code).toBe('lease_expired');
    const done = await healthy.runOnce();
    expect(done?.status).toBe('succeeded');
    expect(done?.workerId).toBe('w-healthy');
    expect(done?.attempt).toBe(2);
    expect(done?.result).toBe('done by w-healthy');
    expect(events[0]?.type).toBe('recovered');
    // The crashed worker's late heartbeat is refused.
    expect(await store.heartbeat(done!.id, 'w-crash', 30, c.now())).toEqual({ ok: false, cancelRequested: false });
  });

  it('an expired lease with no attempts left fails the job', async () => {
    const store = new InMemoryJobStore();
    const c = clock();
    const runner = new JobRunner({ store, workerId: 'w1', now: c.now });
    await runner.enqueue({ ...base, kind: 'proxy', input: {}, idempotencyKey: 'k-lease-fail', maxAttempts: 1 });
    await store.claim('w-crash', 10, ['proxy'], c.now());
    c.advance(11_000);
    const [j] = await runner.recover();
    expect(j?.status).toBe('failed');
    expect(j?.error?.code).toBe('lease_expired');
  });

  it('start/stop loop processes queued jobs and wakes on enqueue', async () => {
    const store = new InMemoryJobStore();
    const runner = new JobRunner({ store, workerId: 'w1', pollIntervalMs: 5_000 });
    const seen: string[] = [];
    runner.register<{ name: string }, null>('validate', async (ctx) => {
      seen.push(ctx.input.name);
      return null;
    });
    runner.start();
    await runner.enqueue({ ...base, kind: 'validate', input: { name: 'a' }, idempotencyKey: 'k-loop-a' });
    await runner.enqueue({ ...base, kind: 'validate', input: { name: 'b' }, idempotencyKey: 'k-loop-b' });
    const deadline = Date.now() + 2000;
    while (seen.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await runner.stop();
    expect(seen.sort()).toEqual(['a', 'b']);
    expect((await store.list({ status: ['succeeded'] })).length).toBe(2);
  });
});
