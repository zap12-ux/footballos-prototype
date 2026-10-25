import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { FailOptions, HeartbeatResult, Job, JobError, JobProgress, JobStore } from '@footballos/media';
import type { Db } from '../db/db.js';
import { processingJobs } from '../db/schema.js';

type Row = typeof processingJobs.$inferSelect;

/** Called inside the store's own transaction so persisted results and job status commit together. */
export type JobStoreHooks = {
  onSucceeded?: (job: Job, result: unknown, tx: Db) => void;
  /** Final failure only (no retry scheduled). */
  onFailed?: (job: Job, error: JobError, tx: Db) => void;
  onCanceled?: (job: Job, tx: Db) => void;
};

export const UPSTREAM_FAILED = 'upstream_failed';

/**
 * SQLite-backed `JobStore` (CONTRACTS §14.2) for `packages/media` `JobRunner`. better-sqlite3 is
 * synchronous, so every method is one statement or one transaction and therefore atomic with
 * respect to other workers on the same database. Adds to the interface: `retry`, chain ordering
 * through `dependsOnJobId` (a job is claimable only once its dependency succeeded; a failed or
 * canceled dependency fails its dependents with `upstream_failed`) and transactional hooks.
 */
export class SqliteJobStore implements JobStore {
  hooks: JobStoreHooks = {};
  constructor(private readonly db: Db) {}

  async insert(job: Job): Promise<Job> {
    this.db.insert(processingJobs).values(toRow(job)).run();
    return job;
  }

  async get(id: string): Promise<Job | null> {
    const row = this.db.select().from(processingJobs).where(eq(processingJobs.id, id)).get();
    return row ? fromRow(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Job | null> {
    const row = this.db.select().from(processingJobs).where(eq(processingJobs.idempotencyKey, key)).get();
    return row ? fromRow(row) : null;
  }

  async claim(workerId: string, leaseSec: number, kinds: string[] | null, now: Date): Promise<Job | null> {
    const nowIso = now.toISOString();
    if (kinds !== null && kinds.length === 0) return null;
    const kindFilter = kinds === null ? sql`1=1` : sql`j.kind IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})`;
    const candidate = sql`(
      SELECT j.id FROM processing_jobs j
      WHERE ${kindFilter}
        AND (j.status = 'queued' OR (j.status = 'retry_wait' AND (j.not_before_at IS NULL OR j.not_before_at <= ${nowIso})))
        AND (j.depends_on_job_id IS NULL OR EXISTS (SELECT 1 FROM processing_jobs d WHERE d.id = j.depends_on_job_id AND d.status = 'succeeded'))
      ORDER BY j.created_at ASC, j.id ASC LIMIT 1)`;
    const row = this.db
      .update(processingJobs)
      .set({
        status: 'running',
        workerId,
        attempt: sql`${processingJobs.attempt} + 1`,
        leaseExpiresAt: new Date(now.getTime() + leaseSec * 1000).toISOString(),
        startedAt: sql`COALESCE(${processingJobs.startedAt}, ${nowIso})`,
        notBeforeAt: null,
      })
      .where(eq(processingJobs.id, candidate))
      .returning()
      .get();
    return row ? fromRow(row) : null;
  }

  async heartbeat(id: string, workerId: string, leaseSec: number, now: Date): Promise<HeartbeatResult> {
    const row = this.db
      .update(processingJobs)
      .set({ leaseExpiresAt: new Date(now.getTime() + leaseSec * 1000).toISOString() })
      .where(and(eq(processingJobs.id, id), eq(processingJobs.status, 'running'), eq(processingJobs.workerId, workerId)))
      .returning({ cancelRequestedAt: processingJobs.cancelRequestedAt })
      .get();
    if (!row) {
      const other = this.db.select({ cancelRequestedAt: processingJobs.cancelRequestedAt }).from(processingJobs).where(eq(processingJobs.id, id)).get();
      return { ok: false, cancelRequested: other?.cancelRequestedAt != null };
    }
    return { ok: true, cancelRequested: row.cancelRequestedAt !== null };
  }

  async updateProgress(id: string, workerId: string, progress: JobProgress, _now: Date): Promise<void> {
    this.db
      .update(processingJobs)
      .set({ progress: { ...progress } })
      .where(and(eq(processingJobs.id, id), eq(processingJobs.status, 'running'), eq(processingJobs.workerId, workerId)))
      .run();
  }

  async complete(id: string, workerId: string, result: unknown, now: Date): Promise<Job | null> {
    return this.db.transaction((tx) => {
      const row = tx
        .update(processingJobs)
        .set({ status: 'succeeded', result: result ?? null, finishedAt: now.toISOString(), leaseExpiresAt: null, error: null })
        .where(and(eq(processingJobs.id, id), eq(processingJobs.status, 'running'), eq(processingJobs.workerId, workerId)))
        .returning()
        .get();
      if (!row) return null;
      const job = fromRow(row);
      this.hooks.onSucceeded?.(job, result, tx);
      return job;
    });
  }

  async fail(id: string, workerId: string, error: JobError, opts: FailOptions, now: Date): Promise<Job | null> {
    return this.db.transaction((tx) => {
      const retrying = opts.retryAt !== null;
      const stored: JobError = { ...error, retryable: retrying };
      const row = tx
        .update(processingJobs)
        .set(
          retrying
            ? { status: 'retry_wait', error: stored, leaseExpiresAt: null, notBeforeAt: opts.retryAt!.toISOString(), workerId: null }
            : { status: 'failed', error: stored, leaseExpiresAt: null, finishedAt: now.toISOString() },
        )
        .where(and(eq(processingJobs.id, id), eq(processingJobs.status, 'running'), eq(processingJobs.workerId, workerId)))
        .returning()
        .get();
      if (!row) return null;
      const job = fromRow(row);
      if (!retrying) {
        this.cascade(tx, job.id, 'failed', now);
        this.hooks.onFailed?.(job, stored, tx);
      }
      return job;
    });
  }

  async requestCancel(id: string, now: Date): Promise<Job | null> {
    return this.db.transaction((tx) => {
      const row = tx.select().from(processingJobs).where(eq(processingJobs.id, id)).get();
      if (!row) return null;
      const nowIso = now.toISOString();
      if (row.status === 'queued' || row.status === 'retry_wait') {
        const updated = tx
          .update(processingJobs)
          .set({ status: 'canceled', canceledAt: nowIso, finishedAt: nowIso, notBeforeAt: null, cancelRequestedAt: nowIso })
          .where(eq(processingJobs.id, id))
          .returning()
          .get()!;
        this.cascade(tx, id, 'canceled', now);
        const job = fromRow(updated);
        this.hooks.onCanceled?.(job, tx);
        return job;
      }
      if (row.status === 'running' && row.cancelRequestedAt === null) {
        const updated = tx.update(processingJobs).set({ cancelRequestedAt: nowIso }).where(eq(processingJobs.id, id)).returning().get()!;
        return fromRow(updated);
      }
      return fromRow(row);
    });
  }

  async markCanceled(id: string, workerId: string, now: Date): Promise<Job | null> {
    return this.db.transaction((tx) => {
      const nowIso = now.toISOString();
      const row = tx
        .update(processingJobs)
        .set({ status: 'canceled', canceledAt: sql`COALESCE(${processingJobs.canceledAt}, ${nowIso})`, finishedAt: nowIso, leaseExpiresAt: null })
        .where(and(eq(processingJobs.id, id), eq(processingJobs.status, 'running'), eq(processingJobs.workerId, workerId)))
        .returning()
        .get();
      if (!row) return null;
      this.cascade(tx, id, 'canceled', now);
      const job = fromRow(row);
      this.hooks.onCanceled?.(job, tx);
      return job;
    });
  }

  async recoverExpiredLeases(now: Date): Promise<Job[]> {
    return this.db.transaction((tx) => {
      const nowIso = now.toISOString();
      const expired = tx
        .select()
        .from(processingJobs)
        .where(and(eq(processingJobs.status, 'running'), lt(processingJobs.leaseExpiresAt, nowIso)))
        .all();
      const out: Job[] = [];
      for (const j of expired) {
        const lostWorker = j.workerId ?? 'unknown';
        let updated: Row;
        if (j.cancelRequestedAt !== null) {
          updated = tx
            .update(processingJobs)
            .set({ status: 'canceled', workerId: null, leaseExpiresAt: null, canceledAt: j.canceledAt ?? nowIso, finishedAt: nowIso })
            .where(eq(processingJobs.id, j.id))
            .returning()
            .get()!;
          this.cascade(tx, j.id, 'canceled', now);
          this.hooks.onCanceled?.(fromRow(updated), tx);
        } else if (j.attempt >= j.maxAttempts) {
          const error: JobError = { code: 'lease_expired', message: `worker ${lostWorker} stopped heartbeating and no attempts remain`, retryable: false };
          updated = tx
            .update(processingJobs)
            .set({ status: 'failed', workerId: null, leaseExpiresAt: null, finishedAt: nowIso, error })
            .where(eq(processingJobs.id, j.id))
            .returning()
            .get()!;
          this.cascade(tx, j.id, 'failed', now);
          this.hooks.onFailed?.(fromRow(updated), error, tx);
        } else {
          updated = tx
            .update(processingJobs)
            .set({ status: 'queued', workerId: null, leaseExpiresAt: null, error: { code: 'lease_expired', message: `worker ${lostWorker} stopped heartbeating; re-queued`, retryable: true } })
            .where(eq(processingJobs.id, j.id))
            .returning()
            .get()!;
        }
        out.push(fromRow(updated));
      }
      return out;
    });
  }

  async list(filter: { teamId?: string; status?: Job['status'][] } = {}): Promise<Job[]> {
    const conds = [];
    if (filter.teamId) conds.push(eq(processingJobs.teamId, filter.teamId));
    if (filter.status && filter.status.length > 0) conds.push(inArray(processingJobs.status, filter.status));
    const rows = this.db.select().from(processingJobs).where(conds.length ? and(...conds) : undefined).orderBy(asc(processingJobs.createdAt), asc(processingJobs.id)).all();
    return rows.map(fromRow);
  }

  // Extensions used by the API ------------------------------------------------------------

  /** Paginated listing newest first; cursor is `createdAt|id` of the last item. */
  listPage(filter: { teamId: string; assetId?: string; status?: Job['status'][]; limit: number; cursor?: string }): { items: Job[]; nextCursor: string | null } {
    const conds = [eq(processingJobs.teamId, filter.teamId)];
    if (filter.assetId) conds.push(eq(processingJobs.assetId, filter.assetId));
    if (filter.status && filter.status.length > 0) conds.push(inArray(processingJobs.status, filter.status));
    if (filter.cursor) {
      const sep = filter.cursor.lastIndexOf('|');
      const at = sep > 0 ? filter.cursor.slice(0, sep) : filter.cursor;
      const id = sep > 0 ? filter.cursor.slice(sep + 1) : '';
      conds.push(or(lt(processingJobs.createdAt, at), and(eq(processingJobs.createdAt, at), lt(processingJobs.id, id)))!);
    }
    const rows = this.db
      .select()
      .from(processingJobs)
      .where(and(...conds))
      .orderBy(desc(processingJobs.createdAt), desc(processingJobs.id))
      .limit(filter.limit + 1)
      .all();
    const items = rows.slice(0, filter.limit).map(fromRow);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > filter.limit && last ? `${last.createdAt}|${last.id}` : null };
  }

  /**
   * Re-queues a `failed` or `canceled` job with the attempt counter reset and the same idempotency
   * key; dependents that failed only because of it (`upstream_failed`) are re-queued as well.
   * Returns null when the job does not exist, or the job unchanged when it is not retryable.
   */
  retry(id: string, _now: Date): Job | null {
    return this.db.transaction((tx) => {
      const row = tx.select().from(processingJobs).where(eq(processingJobs.id, id)).get();
      if (!row) return null;
      if (row.status !== 'failed' && row.status !== 'canceled') return fromRow(row);
      const requeue = (jobId: string) => {
        tx.update(processingJobs)
          .set({ status: 'queued', attempt: 0, error: null, finishedAt: null, canceledAt: null, cancelRequestedAt: null, workerId: null, leaseExpiresAt: null, notBeforeAt: null, progress: { done: 0, total: null, message: 'queued' } })
          .where(eq(processingJobs.id, jobId))
          .run();
        const dependents = tx.select().from(processingJobs).where(eq(processingJobs.dependsOnJobId, jobId)).all();
        for (const d of dependents) {
          if ((d.status === 'failed' || d.status === 'canceled') && d.error?.code === UPSTREAM_FAILED) requeue(d.id);
        }
      };
      requeue(id);
      return fromRow(tx.select().from(processingJobs).where(eq(processingJobs.id, id)).get()!);
    });
  }

  /** Cancels every unfinished job of an asset (used when the asset is deleted). */
  cancelForAsset(tx: Db, assetId: string, now: Date): void {
    const nowIso = now.toISOString();
    tx.update(processingJobs)
      .set({ status: 'canceled', canceledAt: nowIso, finishedAt: nowIso, cancelRequestedAt: nowIso, notBeforeAt: null })
      .where(and(eq(processingJobs.assetId, assetId), inArray(processingJobs.status, ['queued', 'retry_wait'])))
      .run();
    tx.update(processingJobs)
      .set({ cancelRequestedAt: nowIso })
      .where(and(eq(processingJobs.assetId, assetId), eq(processingJobs.status, 'running')))
      .run();
  }

  /** Public entry for hosts that reject a file inside a succeeded `validate` job. */
  failDependents(tx: Db, jobId: string, now: Date): void {
    this.cascade(tx, jobId, 'failed', now);
  }

  /** Dependents of a failed/canceled job end in the same state with `upstream_failed`. */
  private cascade(tx: Db, jobId: string, status: 'failed' | 'canceled', now: Date): void {
    const nowIso = now.toISOString();
    const dependents = tx
      .select()
      .from(processingJobs)
      .where(and(eq(processingJobs.dependsOnJobId, jobId), inArray(processingJobs.status, ['queued', 'retry_wait'])))
      .all();
    for (const d of dependents) {
      const error: JobError = { code: UPSTREAM_FAILED, message: `job ${jobId} (${d.kind} depends on it) ${status}`, retryable: false };
      tx.update(processingJobs)
        .set({ status, error, finishedAt: nowIso, canceledAt: status === 'canceled' ? nowIso : null, notBeforeAt: null })
        .where(eq(processingJobs.id, d.id))
        .run();
      this.cascade(tx, d.id, status, now);
    }
  }
}

export function fromRow(r: Row): Job {
  return {
    id: r.id,
    teamId: r.teamId,
    assetId: r.assetId,
    kind: r.kind,
    status: r.status as Job['status'],
    progress: r.progress,
    attempt: r.attempt,
    maxAttempts: r.maxAttempts,
    leaseExpiresAt: r.leaseExpiresAt,
    workerId: r.workerId,
    idempotencyKey: r.idempotencyKey,
    configVersion: r.configVersion,
    error: r.error ?? null,
    requestedBy: r.requestedBy ?? '',
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    canceledAt: r.canceledAt,
    input: r.input ?? null,
    result: r.result ?? null,
    notBeforeAt: r.notBeforeAt,
    cancelRequestedAt: r.cancelRequestedAt,
  };
}

export function toRow(j: Job & { dependsOnJobId?: string | null }): Row {
  return {
    id: j.id,
    teamId: j.teamId,
    assetId: j.assetId,
    kind: j.kind,
    status: j.status,
    progress: j.progress,
    attempt: j.attempt,
    maxAttempts: j.maxAttempts,
    leaseExpiresAt: j.leaseExpiresAt,
    workerId: j.workerId,
    idempotencyKey: j.idempotencyKey,
    configVersion: j.configVersion,
    error: j.error,
    requestedBy: j.requestedBy || null,
    createdAt: j.createdAt,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    canceledAt: j.canceledAt,
    input: j.input ?? null,
    result: j.result ?? null,
    notBeforeAt: j.notBeforeAt,
    cancelRequestedAt: j.cancelRequestedAt,
    dependsOnJobId: j.dependsOnJobId ?? null,
  };
}
