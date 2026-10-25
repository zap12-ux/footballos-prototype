import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from '../api/api';
import type { ProcessingJob } from '../api/contracts';

export const JOB_POLL_MS = 3000;

/** A job that still needs a worker: polling continues while any such job exists. */
export function isJobActive(job: ProcessingJob): boolean {
  return job.status === 'queued' || job.status === 'running' || job.status === 'retry_wait';
}

export interface JobPollState {
  jobs: ProcessingJob[];
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  /** True while a timer is scheduled (some job is active). */
  polling: boolean;
  reload: () => void;
}

/**
 * `GET /teams/:teamId/jobs?assetId=` every `intervalMs` while any job is queued, running or
 * waiting to retry; stops when every job is terminal (§14.2) and restarts on `reload()`,
 * which callers invoke after enqueueing work (upload complete, "Run inference", retry).
 */
export function useJobPolling(api: Api, teamId: string | null, assetId: string | null, intervalMs = JOB_POLL_MS): JobPollState {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [polling, setPolling] = useState(false);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    const clear = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    async function poll(first: boolean) {
      if (!teamId) {
        setJobs([]);
        setStatus('ready');
        setPolling(false);
        return;
      }
      try {
        const items = await api.media.jobs(teamId, assetId ? { assetId } : {});
        if (!active) return;
        setJobs(items);
        setStatus('ready');
        setError(null);
        if (items.some(isJobActive)) {
          setPolling(true);
          timer.current = setTimeout(() => void poll(false), intervalMs);
        } else setPolling(false);
      } catch (err) {
        if (!active) return;
        setError(err);
        setStatus(first ? 'error' : 'ready');
        // A failed poll is reported and retried once more at the normal interval, then stops.
        if (first) setPolling(false);
        else {
          setPolling(false);
        }
      }
    }
    clear();
    void poll(true);
    return () => {
      active = false;
      clear();
    };
  }, [api, teamId, assetId, intervalMs, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { jobs, status, error, polling, reload };
}
