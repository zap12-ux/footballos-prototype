import type { ReactNode } from 'react';
import type { EnvironmentKind } from '../../api/contracts';
import { describeError, type ActionStatus } from '../../api/hooks';

/** Environment label from `Team.environmentKind`; shown on every screen. */
export function EnvironmentLabel({ kind, detail }: { kind: EnvironmentKind; detail?: string }) {
  const text = kind === 'demo' ? 'Demo' : kind === 'research' ? 'Research' : 'Production';
  return (
    <span className={`env-label env-${kind}`} data-testid="environment-label" title={detail}>
      <span className="env-dot" aria-hidden="true" />
      {text} environment
      {detail ? <span className="sr-only">: {detail}</span> : null}
    </span>
  );
}

export function PageHeader({ title, lede, actions, children }: { title: string; lede?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
      {children}
    </header>
  );
}

/** Loading / error / content for one resource. Always says what is happening in words. */
export function DataState<T>({
  state,
  label,
  children,
}: {
  state: { status: 'loading' | 'ready' | 'error'; data: T | null; error: unknown; reload: () => void };
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') {
    return (
      <div className="data-state loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        Loading {label}…
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="data-state error" role="alert">
        <p>
          <strong>Could not load {label}.</strong> {describeError(state.error)}
        </p>
        <button type="button" onClick={state.reload}>
          Try again
        </button>
      </div>
    );
  }
  return <>{children(state.data as T)}</>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p>
        <strong>{title}</strong>
      </p>
      {children}
    </div>
  );
}

/** Saving / saved / error pill for a write. Text, not colour, carries the meaning. */
export function SaveStatus({ status, error, savedText = 'Saved' }: { status: ActionStatus; error?: unknown; savedText?: string }) {
  if (status === 'idle') return null;
  if (status === 'saving') {
    return (
      <span className="save-status saving" role="status">
        <span className="spinner small" aria-hidden="true" /> Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="save-status saved" role="status">
        ✓ {savedText}
      </span>
    );
  }
  return (
    <span className="save-status error" role="alert">
      ! {describeError(error)}
    </span>
  );
}

const BADGE_CLASS: Record<string, string> = {
  draft: 'badge-draft',
  in_review: 'badge-review',
  approved: 'badge-approved',
  superseded: 'badge-muted',
  proposed: 'badge-draft',
  rejected: 'badge-crimson',
  accepted: 'badge-approved',
  ready: 'badge-approved',
  processing: 'badge-review',
  uploading: 'badge-review',
  uploaded: 'badge-review',
  validated: 'badge-review',
  failed: 'badge-crimson',
  canceled: 'badge-muted',
  deleted: 'badge-muted',
  queued: 'badge-muted',
  running: 'badge-review',
  retry_wait: 'badge-review',
  succeeded: 'badge-approved',
  scheduled: 'badge-muted',
  rescheduled: 'badge-review',
  postponed: 'badge-review',
  final: 'badge-approved',
  active: 'badge-approved',
  injured: 'badge-crimson',
  unavailable: 'badge-review',
  inactive: 'badge-muted',
  extracted: 'badge-approved',
  extracting: 'badge-review',
  review: 'badge-review',
  win: 'badge-approved',
  loss: 'badge-crimson',
  tie: 'badge-muted',
};

export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return <span className={`badge ${BADGE_CLASS[value] ?? 'badge-muted'}`}>{label ?? humanize(value)}</span>;
}

export function formatDateTime(iso: string | null, timeZone?: string): string {
  if (!iso) return 'Date not set';
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDate(iso: string | null, timeZone?: string): string {
  if (!iso) return 'Not set';
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function formatSeconds(sec: number | null): string {
  if (sec === null) return 'unknown';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
