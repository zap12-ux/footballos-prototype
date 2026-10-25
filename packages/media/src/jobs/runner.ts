import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { JobError } from '../types.ts';
import { NonRetryableError, type EnqueueRequest, type Job, type JobHandler, type JobStore } from './types.ts';

export interface BackoffPolicy {
  baseSec: number;
  maxSec: number;
  /** 0..1 fraction of jitter added; 0 for deterministic tests. */
  jitter: number;
}

export interface JobRunnerOptions {
  store: JobStore;
  workerId?: string;
  leaseSec?: number;
  heartbeatSec?: number;
  pollIntervalMs?: number;
  defaultMaxAttempts?: number;
  backoff?: Partial<BackoffPolicy>;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Injectable id generator for tests. */
  newId?: () => string;
  /** Run only these kinds; null = any registered kind. */
  kinds?: string[] | null;
}

export type RunnerEvent =
  | { type: 'claimed'; job: Job }
  | { type: 'progress'; job: Job }
  | { type: 'succeeded'; job: Job }
  | { type: 'retry_wait'; job: Job; retryAt: string }
  | { type: 'failed'; job: Job }
  | { type: 'canceled'; job: Job }
  | { type: 'lease_lost'; job: Job }
  | { type: 'recovered'; jobs: Job[] };

/** Why a handler's AbortSignal fired; read from `signal.reason`. */
export type AbortReason = 'cancel_requested' | 'lease_lost' | 'runner_stopping';

/** Stable idempotency key: sha256 over kind, canonical JSON of inputs and the config version. */
export function idempotencyKeyFor(kind: string, inputs: unknown, configVersion: string): string {
  return createHash('sha256').update(kind).update('\u0000').update(canonicalJson(inputs)).update('\u0000').update(configVersion).digest('hex');
}

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export function backoffSec(attempt: number, policy: BackoffPolicy, random: () => number = Math.random): number {
  const base = Math.min(policy.maxSec, policy.baseSec * 2 ** Math.max(0, attempt - 1));
  const jitter = policy.jitter > 0 ? base * policy.jitter * (random() * 2 - 1) : 0;
  return Math.max(0, base + jitter);
}

/**
 * Executes jobs from a JobStore: claim → heartbeat while running → complete /
 * fail (retry_wait with backoff until maxAttempts) / canceled. Cancellation is
 * cooperative: handlers receive an AbortSignal that fires when the owner
 * requests a cancel (observed via heartbeat) or when the lease is lost.
 */
export class JobRunner extends EventEmitter {
  readonly workerId: string;
  private readonly store: JobStore;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly leaseSec: number;
  private readonly heartbeatSec: number;
  private readonly pollIntervalMs: number;
  private readonly defaultMaxAttempts: number;
  private readonly backoff: BackoffPolicy;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private readonly kinds: string[] | null;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private readonly inFlight = new Map<string, AbortController>();
  private wake: (() => void) | null = null;

  constructor(opts: JobRunnerOptions) {
    super();
    this.store = opts.store;
    this.workerId = opts.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.leaseSec = opts.leaseSec ?? 60;
    this.heartbeatSec = opts.heartbeatSec ?? Math.max(1, Math.floor(this.leaseSec / 3));
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.defaultMaxAttempts = opts.defaultMaxAttempts ?? 3;
    this.backoff = { baseSec: 5, maxSec: 300, jitter: 0.2, ...opts.backoff };
    this.now = opts.now ?? (() => new Date());
    this.newId = opts.newId ?? randomUUID;
    this.kinds = opts.kinds ?? null;
  }

  register<I, R>(kind: string, handler: JobHandler<I, R>): this {
    this.handlers.set(kind, handler as JobHandler);
    return this;
  }

  /** Enqueues a job or returns the existing one with the same idempotency key. */
  async enqueue(req: EnqueueRequest): Promise<{ job: Job; duplicate: boolean }> {
    const existing = await this.store.findByIdempotencyKey(req.idempotencyKey);
    if (existing) return { job: existing, duplicate: true };
    const nowIso = this.now().toISOString();
    const job: Job = {
      id: this.newId(),
      teamId: req.teamId,
      assetId: req.assetId,
      kind: req.kind,
      status: 'queued',
      progress: { done: 0, total: null, message: 'queued' },
      attempt: 0,
      maxAttempts: req.maxAttempts ?? this.defaultMaxAttempts,
      leaseExpiresAt: null,
      workerId: null,
      idempotencyKey: req.idempotencyKey,
      configVersion: req.configVersion,
      error: null,
      requestedBy: req.requestedBy,
      createdAt: nowIso,
      startedAt: null,
      finishedAt: null,
      canceledAt: null,
      input: req.input,
      result: null,
      notBeforeAt: null,
      cancelRequestedAt: null,
    };
    try {
      const inserted = await this.store.insert(job);
      this.wake?.();
      return { job: inserted, duplicate: false };
    } catch (err) {
      // Lost a race with another enqueue of the same key.
      const again = await this.store.findByIdempotencyKey(req.idempotencyKey);
      if (again) return { job: again, duplicate: true };
      throw err;
    }
  }

  async requestCancel(jobId: string): Promise<Job | null> {
    const job = await this.store.requestCancel(jobId, this.now());
    const ctrl = this.inFlight.get(jobId);
    if (ctrl && !ctrl.signal.aborted) ctrl.abort('cancel_requested' satisfies AbortReason);
    return job;
  }

  /** Puts expired leases back in the queue. Call at startup and periodically. */
  async recover(): Promise<Job[]> {
    const jobs = await this.store.recoverExpiredLeases(this.now());
    if (jobs.length > 0) this.emit('event', { type: 'recovered', jobs } satisfies RunnerEvent);
    return jobs;
  }

  /** Claims and runs at most one job. Returns the finished job, or null when nothing was claimable. */
  async runOnce(): Promise<Job | null> {
    const kinds = this.kinds ?? [...this.handlers.keys()];
    const job = await this.store.claim(this.workerId, this.leaseSec, kinds, this.now());
    if (!job) return null;
    this.emit('event', { type: 'claimed', job } satisfies RunnerEvent);
    return this.execute(job);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    for (const ctrl of this.inFlight.values()) if (!ctrl.signal.aborted) ctrl.abort('runner_stopping' satisfies AbortReason);
    await this.loopPromise;
    this.loopPromise = null;
  }

  private async loop(): Promise<void> {
    await this.recover();
    while (this.running) {
      let did: Job | null = null;
      try {
        did = await this.runOnce();
      } catch (err) {
        this.emit('error', err);
      }
      if (!did && this.running) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            this.wake = null;
            resolve();
          }, this.pollIntervalMs);
          this.wake = () => {
            clearTimeout(t);
            this.wake = null;
            resolve();
          };
        });
      }
    }
  }

  private async execute(job: Job): Promise<Job> {
    const handler = this.handlers.get(job.kind);
    const ctrl = new AbortController();
    this.inFlight.set(job.id, ctrl);
    const abort = (reason: AbortReason) => {
      if (!ctrl.signal.aborted) ctrl.abort(reason);
    };
    if (job.cancelRequestedAt !== null) abort('cancel_requested');

    const hb = setInterval(() => {
      void this.store.heartbeat(job.id, this.workerId, this.leaseSec, this.now()).then((r) => {
        if (!r.ok) abort('lease_lost');
        else if (r.cancelRequested) abort('cancel_requested');
      });
    }, this.heartbeatSec * 1000);

    const finish = async (outcome: () => Promise<Job | null>, event: (j: Job) => RunnerEvent): Promise<Job> => {
      const updated = await outcome();
      if (updated) this.emit('event', event(updated));
      return updated ?? ((await this.store.get(job.id)) as Job);
    };

    try {
      if (!handler) {
        return await finish(
          () => this.store.fail(job.id, this.workerId, { code: 'no_handler', message: `no handler registered for kind ${job.kind}` }, { retryAt: null }, this.now()),
          (j) => ({ type: 'failed', job: j }),
        );
      }
      const result = await handler({
        job,
        input: job.input,
        signal: ctrl.signal,
        workerId: this.workerId,
        progress: async (p) => {
          const progress = { done: p.done, total: p.total ?? job.progress.total, message: p.message ?? job.progress.message };
          job.progress = progress;
          await this.store.updateProgress(job.id, this.workerId, progress, this.now());
          this.emit('event', { type: 'progress', job: { ...job, progress } } satisfies RunnerEvent);
        },
      });
      if (ctrl.signal.aborted) return await this.afterAbort(job, ctrl.signal.reason as AbortReason);
      return await finish(
        () => this.store.complete(job.id, this.workerId, result ?? null, this.now()),
        (j) => ({ type: 'succeeded', job: j }),
      );
    } catch (err) {
      if (ctrl.signal.aborted) return await this.afterAbort(job, ctrl.signal.reason as AbortReason);
      const error = toJobError(err);
      const retryable = !(err instanceof NonRetryableError) && job.attempt < job.maxAttempts;
      if (retryable) {
        const delay = backoffSec(job.attempt, this.backoff);
        const retryAt = new Date(this.now().getTime() + delay * 1000);
        return await finish(
          () => this.store.fail(job.id, this.workerId, error, { retryAt }, this.now()),
          (j) => ({ type: 'retry_wait', job: j, retryAt: retryAt.toISOString() }),
        );
      }
      return await finish(
        () => this.store.fail(job.id, this.workerId, error, { retryAt: null }, this.now()),
        (j) => ({ type: 'failed', job: j }),
      );
    } finally {
      clearInterval(hb);
      this.inFlight.delete(job.id);
    }
  }

  private async afterAbort(job: Job, reason: AbortReason): Promise<Job> {
    if (reason === 'cancel_requested') {
      const store = this.store as JobStore & { markCanceled?: (id: string, workerId: string, now: Date) => Promise<Job | null> };
      const updated = store.markCanceled
        ? await store.markCanceled(job.id, this.workerId, this.now())
        : await this.store.fail(job.id, this.workerId, { code: 'canceled', message: 'canceled by request' }, { retryAt: null }, this.now());
      const j = updated ?? ((await this.store.get(job.id)) as Job);
      this.emit('event', { type: 'canceled', job: j } satisfies RunnerEvent);
      return j;
    }
    // Lease lost: another worker may own the job now. Runner stopping: leave the record so the
    // lease expires and another worker (or this one after restart) re-claims it.
    this.emit('event', { type: 'lease_lost', job } satisfies RunnerEvent);
    return ((await this.store.get(job.id)) as Job) ?? job;
  }
}

function toJobError(err: unknown): JobError {
  if (err instanceof NonRetryableError) return { code: err.code, message: err.message };
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return { code: (err as { code: string }).code, message: err instanceof Error ? err.message : String(err) };
  }
  return { code: 'handler_error', message: err instanceof Error ? err.message : String(err) };
}
