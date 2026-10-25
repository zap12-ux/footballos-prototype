import type { Api } from '../../api/api';
import { describeError, useAction } from '../../api/hooks';
import type { ProcessingJob } from '../../api/contracts';
import { StatusBadge, humanize } from '../shell/ui';

export function JobProgress({ job, api, onChanged }: { job: ProcessingJob; api?: Api; onChanged?: () => void }) {
  const pct = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : null;
  const cancel = useAction(async () => {
    if (!api) return;
    await api.media.cancelJob(job.id);
    onChanged?.();
  });
  const retry = useAction(async () => {
    if (!api) return;
    await api.media.retryJob(job.id);
    onChanged?.();
  });
  const canCancel = job.status === 'queued' || job.status === 'running' || job.status === 'retry_wait';
  const canRetry = job.status === 'failed' || job.status === 'canceled';
  return (
    <div className="job-progress" data-testid={`job-${job.kind}`}>
      <span>
        <StatusBadge value={job.status} /> {humanize(job.kind)}
        {job.attempt > 1 ? <span className="small muted"> · attempt {job.attempt} of {job.maxAttempts}</span> : null}
        {api && (canCancel || canRetry) ? (
          <>
            {' '}
            {canCancel ? (
              <button type="button" className="link small" onClick={() => void cancel.run()} disabled={cancel.status === 'saving'}>
                Cancel
              </button>
            ) : null}
            {canRetry ? (
              <button type="button" className="link small" onClick={() => void retry.run()} disabled={retry.status === 'saving'}>
                Retry
              </button>
            ) : null}
          </>
        ) : null}
      </span>
      {pct !== null ? (
        <progress value={job.progress.done} max={job.progress.total ?? undefined} aria-label={`${humanize(job.kind)} progress`}>
          {pct}%
        </progress>
      ) : null}
      <span className="small muted">{job.progress.message}</span>
      {job.error ? (
        <span className="small field-error" role="alert">
          {job.error.code === 'provider_unavailable' ? 'Provider unavailable: ' : ''}
          {job.error.message}
        </span>
      ) : null}
      {cancel.status === 'error' || retry.status === 'error' ? <span className="small field-error">{describeError(cancel.error ?? retry.error)}</span> : null}
    </div>
  );
}

export function JobList({ jobs, polling, error, onReload, api }: { jobs: ProcessingJob[]; polling: boolean; error: unknown; onReload: () => void; api?: Api }) {
  if (jobs.length === 0 && !error) return null;
  return (
    <div className="job-list" aria-live="polite">
      {error ? (
        <p className="small field-error" role="alert">
          Could not refresh jobs: {describeError(error)}{' '}
          <button type="button" className="link small" onClick={onReload}>
            Try again
          </button>
        </p>
      ) : null}
      {jobs.map((j) => (
        <JobProgress key={j.id} job={j} api={api} onChanged={onReload} />
      ))}
      <p className="small muted" data-testid="job-polling">
        {polling ? 'Refreshing every 3 seconds while work is running.' : 'All jobs are finished; not polling.'}
      </p>
    </div>
  );
}
