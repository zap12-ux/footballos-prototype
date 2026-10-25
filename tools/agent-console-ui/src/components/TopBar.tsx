import type { ConnectionStatus, Run, StateSnapshot } from '../types';
import { staleAfterMin } from '../lib/derive';
import { isStale, relativeTime } from '../lib/time';

interface Props {
  runs: Run[];
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  snapshot: StateSnapshot | null;
  connection: ConnectionStatus;
  lastSeq: number;
  nowIso: string;
  onRefresh: () => void;
}

export function TopBar({ runs, selectedRunId, onSelectRun, snapshot, connection, lastSeq, nowIso, onRefresh }: Props) {
  const run = snapshot?.run ?? runs.find((r) => r.id === selectedRunId) ?? null;
  const limit = staleAfterMin(snapshot);
  const last = snapshot?.lastRuntimeEventAt ?? null;
  const stale = last ? isStale(last, nowIso, limit) : false;
  return (
    <header className="topbar" role="banner">
      <div className="brand">
        FootballOS <small>Agent Build Console</small>
      </div>
      <label>
        Run
        <select aria-label="Run" value={selectedRunId ?? ''} onChange={(e) => onSelectRun(e.target.value)} disabled={runs.length === 0}>
          {runs.length === 0 && <option value="">(no runs)</option>}
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.kind === 'fixture' ? '[FIXTURE] ' : ''}
              {r.label} · {r.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {run && (run.kind === 'fixture' ? <span className="badge badge-fixture">FIXTURE</span> : <span className="badge badge-live">LIVE</span>)}
      <div className="spacer" />
      <div className="health" aria-live="polite">
        <span>
          latest runtime update:{' '}
          {last ? (
            <>
              <span className="mono">{relativeTime(last, nowIso)}</span>
              {stale && <span className="stale"> STALE (&gt; {limit} min)</span>}
            </>
          ) : (
            <span className="mono">none yet</span>
          )}
        </span>
        <span aria-hidden="true">·</span>
        <span className={`dot ${connection}`} aria-hidden="true" />
        <span>
          {connection} <span className="mono">seq {lastSeq}</span>
        </span>
        <button type="button" className="btn" onClick={onRefresh} title="Refetch the snapshot from the server">
          Refresh
        </button>
      </div>
    </header>
  );
}
