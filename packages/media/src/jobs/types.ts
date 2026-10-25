import type { JobError, JobProgress, ProcessingJob } from '../types.ts';

/**
 * Job record held by a JobStore. It is CONTRACTS §5 ProcessingJob plus the
 * store-internal fields adopted in §14.2: `input` (handler payload), `result`
 * (handler return value), `notBeforeAt` (retry_wait wake-up) and
 * `cancelRequestedAt` (cooperative cancel of a running job). `kind` is widened
 * from the contract's `JobKind` enum to `string` so the runner can host kinds
 * the contract does not list yet; a store that persists `ProcessingJob` rows
 * narrows it again.
 */
export interface Job extends Omit<ProcessingJob, 'kind'> {
  kind: string;
  input: unknown;
  result: unknown;
  notBeforeAt: string | null;
  cancelRequestedAt: string | null;
}

export interface EnqueueRequest {
  teamId: string;
  assetId: string | null;
  kind: string;
  input: unknown;
  requestedBy: string;
  /** sha256 of kind + inputs + config version; see `idempotencyKeyFor`. */
  idempotencyKey: string;
  configVersion: string;
  maxAttempts?: number;
}

export interface HeartbeatResult {
  /** False when the lease no longer belongs to this worker (expired and re-claimed, or canceled). */
  ok: boolean;
  cancelRequested: boolean;
}

export interface FailOptions {
  /** When set, the job goes to `retry_wait` and becomes claimable at this time; otherwise it is `failed`. */
  retryAt: Date | null;
}

/**
 * Store-agnostic persistence contract. Every method must be atomic with respect
 * to concurrent workers (SQLite: one transaction per call). `claim` must never
 * hand the same job to two workers while a lease is live.
 */
export interface JobStore {
  insert(job: Job): Promise<Job>;
  get(id: string): Promise<Job | null>;
  findByIdempotencyKey(key: string): Promise<Job | null>;
  /** Claims the oldest claimable job (queued, or retry_wait whose notBeforeAt has passed) of the given kinds. */
  claim(workerId: string, leaseSec: number, kinds: string[] | null, now: Date): Promise<Job | null>;
  heartbeat(id: string, workerId: string, leaseSec: number, now: Date): Promise<HeartbeatResult>;
  updateProgress(id: string, workerId: string, progress: JobProgress, now: Date): Promise<void>;
  complete(id: string, workerId: string, result: unknown, now: Date): Promise<Job | null>;
  fail(id: string, workerId: string, error: JobError, opts: FailOptions, now: Date): Promise<Job | null>;
  /** Cancels a queued/retry_wait job immediately; marks a running job for cooperative cancel. */
  requestCancel(id: string, now: Date): Promise<Job | null>;
  /** Finalises a running job whose handler observed a cancel request. */
  markCanceled(id: string, workerId: string, now: Date): Promise<Job | null>;
  /** Running jobs whose lease expired go back to queued (or failed when attempts are exhausted). Returns the affected jobs. */
  recoverExpiredLeases(now: Date): Promise<Job[]>;
  list(filter?: { teamId?: string; status?: Job['status'][] }): Promise<Job[]>;
}

export interface HandlerContext<I = unknown> {
  job: Job;
  input: I;
  signal: AbortSignal;
  progress(p: Partial<JobProgress> & { done: number }): Promise<void>;
  workerId: string;
}

export type JobHandler<I = unknown, R = unknown> = (ctx: HandlerContext<I>) => Promise<R>;

/** Thrown by handlers to mark a failure that must not be retried. */
export class NonRetryableError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NonRetryableError';
    this.code = code;
  }
}
