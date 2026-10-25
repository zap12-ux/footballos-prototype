import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApi, useResource } from '../api/hooks';
import type { MediaAsset, Unit, UploadContext } from '../api/contracts';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, StatusBadge, formatBytes, formatDateTime, formatSeconds, humanize } from '../components/shell/ui';
import { JobList } from '../components/film/JobList';
import { isJobActive, useJobPolling } from '../film/jobPolling';
import { createUploadClient, type UploadClient, type UploadHandle, type UploadOutcome, type UploadProgress } from '../film/uploadClient';
import type { InFlightUpload } from '../film/uploadRegistry';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { FootageQualityNotes } from './AssetPage';

function UploadStatus({ progress, outcome, onCancel, assetHref }: { progress: UploadProgress | null; outcome: UploadOutcome | null; onCancel: () => void; assetHref: (id: string) => string }) {
  if (!progress) return null;
  const pct = progress.totalBytes > 0 ? Math.round((progress.sentBytes / progress.totalBytes) * 100) : null;
  const running = progress.phase === 'hashing' || progress.phase === 'creating' || progress.phase === 'uploading' || progress.phase === 'completing';
  return (
    <div className="upload-status card tight" aria-live="polite" data-testid="upload-status">
      <p>
        <strong>
          {progress.phase === 'hashing' && 'Fingerprinting the file…'}
          {progress.phase === 'creating' && 'Creating the upload…'}
          {progress.phase === 'uploading' && `Uploading: ${formatBytes(progress.sentBytes)} of ${formatBytes(progress.totalBytes)}${pct !== null ? ` (${pct}%)` : ''}`}
          {progress.phase === 'completing' && 'Finishing…'}
          {progress.phase === 'done' && 'Upload complete; processing has started.'}
          {progress.phase === 'duplicate' && 'This file is already in the library.'}
          {progress.phase === 'canceled' && 'Upload canceled.'}
          {progress.phase === 'error' && 'Upload failed.'}
        </strong>
      </p>
      {progress.phase === 'uploading' ? <progress value={progress.sentBytes} max={progress.totalBytes} aria-label="Upload progress" /> : null}
      {progress.note ? <p className={`small ${progress.phase === 'error' ? 'field-error' : 'muted'}`}>{progress.note}</p> : null}
      {outcome?.kind === 'duplicate' ? (
        <p className="small">
          <Link to={assetHref(outcome.existingAssetId)}>Open the existing film</Link>
        </p>
      ) : null}
      {outcome?.kind === 'completed' ? (
        <p className="small">
          <Link to={assetHref(outcome.asset.id)}>Open {outcome.asset.originalFilename}</Link>
        </p>
      ) : null}
      {running ? (
        <div className="btn-row">
          <button type="button" onClick={onCancel}>
            Cancel upload
          </button>
        </div>
      ) : null}
    </div>
  );
}

function UploadForm({ gameId, client, onFinished, assetHref }: { gameId: string; client: UploadClient; onFinished: () => void; assetHref: (id: string) => string }) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [analyzedTeam, setAnalyzedTeam] = useState<UploadContext['analyzedTeam']>('us');
  const [analyzedUnit, setAnalyzedUnit] = useState<UploadContext['analyzedUnit']>('mixed');
  const [perspective, setPerspective] = useState<UploadContext['perspective']>('sideline_fixed');
  const [teamCues, setTeamCues] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const handle = useRef<UploadHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = client.onProgress(setProgress);
    return unsubscribe;
  }, [client]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!file) {
      setFormError('Choose a video file first.');
      return;
    }
    setOutcome(null);
    handle.current = client.start({ gameId, file, context: { analyzedTeam, analyzedUnit, perspective, teamCues: teamCues.trim() || null } });
    const result = await handle.current.result;
    setOutcome(result);
    handle.current = null;
    if (result.kind === 'completed') {
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      onFinished();
    }
  }

  const running = !!progress && (progress.phase === 'hashing' || progress.phase === 'creating' || progress.phase === 'uploading' || progress.phase === 'completing');

  return (
    <form className="card tight" onSubmit={(e) => void submit(e)} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Upload film for this game</h2>
      <p className="small muted">
        Four questions, asked once. The file is sent in resumable chunks; if the connection drops or the page reloads, the upload continues from where the server got to. The server checks for a readable video stream before anything else runs.
      </p>
      <div className="field-grid">
        <label htmlFor={`${id}-file`} className="span-2">
          Video file (MP4 or MOV)
          <input ref={fileInput} id={`${id}-file`} type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-describedby={formError ? `${id}-err` : undefined} disabled={running} />
        </label>
        <fieldset>
          <legend>Whose film is this?</legend>
          <div className="radio-row">
            <label>
              <input type="radio" name={`${id}-team`} checked={analyzedTeam === 'us'} onChange={() => setAnalyzedTeam('us')} /> Our team
            </label>
            <label>
              <input type="radio" name={`${id}-team`} checked={analyzedTeam === 'opponent'} onChange={() => setAnalyzedTeam('opponent')} /> Opponent
            </label>
          </div>
        </fieldset>
        <label htmlFor={`${id}-unit`}>
          Unit on film
          <select id={`${id}-unit`} value={analyzedUnit} onChange={(e) => setAnalyzedUnit(e.target.value as Unit | 'mixed')}>
            <option value="mixed">Whole game (mixed)</option>
            <option value="offense">Offense only</option>
            <option value="defense">Defense only</option>
            <option value="special_teams">Special teams only</option>
          </select>
        </label>
        <label htmlFor={`${id}-persp`}>
          Camera
          <select id={`${id}-persp`} value={perspective} onChange={(e) => setPerspective(e.target.value as UploadContext['perspective'])}>
            <option value="sideline_fixed">Fixed sideline</option>
            <option value="endzone">End zone</option>
            <option value="broadcast">Broadcast</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label htmlFor={`${id}-cues`}>
          How to tell the teams apart
          <input id={`${id}-cues`} type="text" placeholder="e.g. white jerseys, gold helmets" value={teamCues} onChange={(e) => setTeamCues(e.target.value)} />
        </label>
      </div>
      {formError ? (
        <p className="field-error" id={`${id}-err`} role="alert">
          {formError}
        </p>
      ) : null}
      <div className="btn-row">
        <button type="submit" className="primary" disabled={running}>
          {running ? 'Uploading…' : 'Start upload'}
        </button>
      </div>
      <UploadStatus progress={progress} outcome={outcome} onCancel={() => handle.current?.cancel()} assetHref={assetHref} />
    </form>
  );
}

function InterruptedUploads({ gameId, client, onFinished, assetHref }: { gameId: string; client: UploadClient; onFinished: () => void; assetHref: (id: string) => string }) {
  const [records, setRecords] = useState<InFlightUpload[]>(() => client.registry.list(gameId));
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<UploadHandle | null>(null);
  useEffect(() => client.onProgress(setProgress), [client]);
  useEffect(() => setRecords(client.registry.list(gameId)), [client, gameId, outcome]);

  if (records.length === 0) return null;

  async function resume(record: InFlightUpload, file: File) {
    setError(null);
    setOutcome(null);
    handle.current = client.resume({ record, file });
    const result = await handle.current.result;
    handle.current = null;
    setOutcome(result);
    if (result.kind === 'completed') onFinished();
    if (result.kind === 'error') setError(result.error instanceof Error ? result.error.message : String(result.error));
    setRecords(client.registry.list(gameId));
  }

  return (
    <section className="card tight" aria-labelledby="interrupted-heading" data-testid="interrupted-uploads">
      <h2 id="interrupted-heading">Interrupted uploads ({records.length})</h2>
      <p className="small muted">These uploads did not finish in this browser. Choose the same file again to continue from where the server got to; nothing already received is sent twice.</p>
      <ul className="interrupted-list">
        {records.map((r) => (
          <li key={r.uploadId}>
            <span className="mono">{r.filename}</span> <span className="small muted">· {formatBytes(r.byteSize)} · started {formatDateTime(r.startedAt)}</span>
            <label className="small">
              Choose the same file to resume
              <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void resume(r, f); }} />
            </label>
            <button type="button" className="link small" onClick={() => { client.registry.forget(r.uploadId); setRecords(client.registry.list(gameId)); }}>
              Forget
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="small field-error" role="alert">
          {error}
        </p>
      ) : null}
      <UploadStatus progress={progress} outcome={outcome} onCancel={() => handle.current?.cancel()} assetHref={assetHref} />
    </section>
  );
}

export function FilmPage() {
  const api = useApi();
  const ws = useWorkspace();
  const me = useMe();
  const game = ws.game;
  const team = ws.team;
  const canUpload = me.memberships.some((m) => m.teamId === team?.id && m.role !== 'viewer');
  const client = useMemo(() => createUploadClient(api), [api]);

  const assets = useResource(async () => (game ? api.media.assets(game.id) : ([] as MediaAsset[])), [api, game?.id]);
  const jobs = useJobPolling(api, team?.id ?? null, null);
  const wasActive = useRef(false);
  useEffect(() => {
    const active = jobs.jobs.some(isJobActive);
    if (wasActive.current && !active) assets.reload();
    wasActive.current = active;
  }, [jobs.jobs, assets]);

  const assetHref = (assetId: string) => ws.href(`/app/film/${assetId}`);
  const refresh = () => {
    assets.reload();
    jobs.reload();
  };

  return (
    <>
      <PageHeader title="Our Team Film" lede={game ? <>Film attached to {ws.gameLabel(game)}. Opponent film for the same week lives here too and feeds scouting.</> : 'Pick a game in the context bar.'} />
      {game && canUpload ? (
        <>
          <InterruptedUploads gameId={game.id} client={client} onFinished={refresh} assetHref={assetHref} />
          <UploadForm gameId={game.id} client={client} onFinished={refresh} assetHref={assetHref} />
        </>
      ) : null}
      <DataState state={assets} label="film">
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="No film for this game yet." />
          ) : (
            <ul className="asset-list">
              {items.map((a) => {
                const assetJobs = jobs.jobs.filter((j) => j.assetId === a.id);
                const ours = a.context.analyzedTeam === 'us';
                return (
                  <li key={a.id} className="card asset">
                    <div className="asset-head">
                      <div>
                        <h2 className="mono">
                          <Link to={assetHref(a.id)}>{a.originalFilename}</Link>
                        </h2>
                        <p className="small muted">
                          {ours ? 'Our film' : 'Opponent film'} · {humanize(a.context.analyzedUnit)} · {humanize(a.context.perspective)} · {formatBytes(a.byteSize)}
                          {a.durationSec !== null ? ` · ${formatSeconds(a.durationSec)}` : ''} · uploaded {formatDateTime(a.createdAt, team?.timezone)}
                        </p>
                      </div>
                      <StatusBadge value={a.status} />
                    </div>
                    {a.status === 'rejected' ? (
                      <p className="callout warn" role="alert">
                        <strong>Rejected.</strong> {a.rejectionReason ?? 'No reason recorded.'}
                      </p>
                    ) : null}
                    {a.quality ? <FootageQualityNotes asset={a} /> : null}
                    {assetJobs.length ? <JobList jobs={assetJobs} polling={jobs.polling} error={null} onReload={jobs.reload} api={api} /> : null}
                    <p className="btn-row">
                      <Link className="btn" to={assetHref(a.id)}>
                        {a.status === 'ready' ? 'Open plays and labels' : 'Open'}
                      </Link>
                    </p>
                  </li>
                );
              })}
            </ul>
          )
        }
      </DataState>
    </>
  );
}
