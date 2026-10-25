import type { JobError, JobProgress } from '../types.ts';
import type { FailOptions, HeartbeatResult, Job, JobStore } from './types.ts';

/**
 * In-memory JobStore for tests and single-process demos. Node is single
 * threaded and every method does its work synchronously before awaiting, so
 * each call is atomic with respect to other callers.
 */
export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();

  async insert(job: Job): Promise<Job> {
    if (this.jobs.has(job.id)) throw new Error(`job ${job.id} already exists`);
    this.jobs.set(job.id, structuredClone(job));
    return structuredClone(job);
  }

  async get(id: string): Promise<Job | null> {
    const j = this.jobs.get(id);
    return j ? structuredClone(j) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Job | null> {
    for (const j of this.jobs.values()) if (j.idempotencyKey === key) return structuredClone(j);
    return null;
  }

  async claim(workerId: string, leaseSec: number, kinds: string[] | null, now: Date): Promise<Job | null> {
    const nowMs = now.getTime();
    const candidates = [...this.jobs.values()]
      .filter((j) => kinds === null || kinds.includes(j.kind))
      .filter(
        (j) =>
          j.status === 'queued' ||
          (j.status === 'retry_wait' && (j.notBeforeAt === null || Date.parse(j.notBeforeAt) <= nowMs)),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const j = candidates[0];
    if (!j) return null;
    j.status = 'running';
    j.workerId = workerId;
    j.attempt += 1;
    j.leaseExpiresAt = new Date(nowMs + leaseSec * 1000).toISOString();
    j.startedAt = j.startedAt ?? now.toISOString();
    j.notBeforeAt = null;
    return structuredClone(j);
  }

  async heartbeat(id: string, workerId: string, leaseSec: number, now: Date): Promise<HeartbeatResult> {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.workerId !== workerId) return { ok: false, cancelRequested: j?.cancelRequestedAt !== null && j?.cancelRequestedAt !== undefined };
    j.leaseExpiresAt = new Date(now.getTime() + leaseSec * 1000).toISOString();
    return { ok: true, cancelRequested: j.cancelRequestedAt !== null };
  }

  async updateProgress(id: string, workerId: string, progress: JobProgress, _now: Date): Promise<void> {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.workerId !== workerId) return;
    j.progress = { ...progress };
  }

  async complete(id: string, workerId: string, result: unknown, now: Date): Promise<Job | null> {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.workerId !== workerId) return null;
    j.status = 'succeeded';
    j.result = result;
    j.finishedAt = now.toISOString();
    j.leaseExpiresAt = null;
    j.error = null;
    return structuredClone(j);
  }

  async fail(id: string, workerId: string, error: JobError, opts: FailOptions, now: Date): Promise<Job | null> {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.workerId !== workerId) return null;
    j.error = { ...error };
    j.leaseExpiresAt = null;
    if (opts.retryAt) {
      j.status = 'retry_wait';
      j.notBeforeAt = opts.retryAt.toISOString();
      j.workerId = null;
    } else {
      j.status = 'failed';
      j.finishedAt = now.toISOString();
    }
    return structuredClone(j);
  }

  async requestCancel(id: string, now: Date): Promise<Job | null> {
    const j = this.jobs.get(id);
    if (!j) return null;
    if (j.status === 'queued' || j.status === 'retry_wait') {
      j.status = 'canceled';
      j.canceledAt = now.toISOString();
      j.finishedAt = now.toISOString();
      j.notBeforeAt = null;
    } else if (j.status === 'running' && j.cancelRequestedAt === null) {
      j.cancelRequestedAt = now.toISOString();
    }
    return structuredClone(j);
  }

  /** Called by the runner after a handler observed the abort: finalises the record. */
  async markCanceled(id: string, workerId: string, now: Date): Promise<Job | null> {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'running' || j.workerId !== workerId) return null;
    j.status = 'canceled';
    j.canceledAt = j.canceledAt ?? now.toISOString();
    j.finishedAt = now.toISOString();
    j.leaseExpiresAt = null;
    return structuredClone(j);
  }

  async recoverExpiredLeases(now: Date): Promise<Job[]> {
    const nowMs = now.getTime();
    const out: Job[] = [];
    for (const j of this.jobs.values()) {
      if (j.status !== 'running' || j.leaseExpiresAt === null || Date.parse(j.leaseExpiresAt) > nowMs) continue;
      const lostWorker = j.workerId;
      j.workerId = null;
      j.leaseExpiresAt = null;
      if (j.cancelRequestedAt !== null) {
        j.status = 'canceled';
        j.canceledAt = j.canceledAt ?? now.toISOString();
        j.finishedAt = now.toISOString();
      } else if (j.attempt >= j.maxAttempts) {
        j.status = 'failed';
        j.finishedAt = now.toISOString();
        j.error = { code: 'lease_expired', message: `worker ${lostWorker ?? 'unknown'} stopped heartbeating and no attempts remain` };
      } else {
        j.status = 'queued';
        j.error = { code: 'lease_expired', message: `worker ${lostWorker ?? 'unknown'} stopped heartbeating; re-queued` };
      }
      out.push(structuredClone(j));
    }
    return out;
  }

  async list(filter: { teamId?: string; status?: Job['status'][] } = {}): Promise<Job[]> {
    return [...this.jobs.values()]
      .filter((j) => (filter.teamId ? j.teamId === filter.teamId : true))
      .filter((j) => (filter.status ? filter.status.includes(j.status) : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((j) => structuredClone(j));
  }
}
