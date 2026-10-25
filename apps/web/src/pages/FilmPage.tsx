import { useId, useState, type FormEvent } from 'react';
import { useApi, useAction, useResource } from '../api/hooks';
import type { MediaAsset, PlaySegment, ProcessingJob, Unit, UploadContext } from '../api/contracts';
import { DataState, EmptyState, PageHeader, SaveStatus, StatusBadge, formatBytes, formatDateTime, formatSeconds, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

function UploadForm({ gameId, onCreated }: { gameId: string; onCreated: () => void }) {
  const api = useApi();
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [analyzedTeam, setAnalyzedTeam] = useState<UploadContext['analyzedTeam']>('us');
  const [analyzedUnit, setAnalyzedUnit] = useState<UploadContext['analyzedUnit']>('mixed');
  const [perspective, setPerspective] = useState<UploadContext['perspective']>('sideline_fixed');
  const [teamCues, setTeamCues] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const create = useAction(async () => {
    if (!file) throw new Error('Choose a video file first.');
    const asset = await api.media.createUpload(gameId, {
      filename: file.name,
      byteSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      context: { analyzedTeam, analyzedUnit, perspective, teamCues: teamCues.trim() || null },
    });
    setFile(null);
    onCreated();
    return asset;
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!file) {
      setFormError('Choose a video file first.');
      return;
    }
    void create.run();
  }

  return (
    <form className="card tight" onSubmit={submit} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Upload film for this game</h2>
      <p className="small muted">
        Four questions, asked once. The file is checked for a readable video stream before anything else runs; uploads resume if the connection drops.
      </p>
      <div className="field-grid">
        <label htmlFor={`${id}-file`} className="span-2">
          Video file (MP4 or MOV)
          <input id={`${id}-file`} type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-describedby={formError ? `${id}-err` : undefined} />
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
        <button type="submit" className="primary" disabled={create.status === 'saving'}>
          {create.status === 'saving' ? 'Starting upload…' : 'Start upload'}
        </button>
        <SaveStatus status={create.status} error={create.error} savedText="Upload created; validation queued" />
      </div>
    </form>
  );
}

function JobProgress({ job }: { job: ProcessingJob }) {
  const pct = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : null;
  return (
    <div className="job-progress">
      <span>
        <StatusBadge value={job.status} /> {humanize(job.kind)}
        {job.attempt > 1 ? <span className="small muted"> · attempt {job.attempt} of {job.maxAttempts}</span> : null}
      </span>
      {pct !== null ? (
        <progress value={job.progress.done} max={job.progress.total ?? undefined} aria-label={`${humanize(job.kind)} progress`}>
          {pct}%
        </progress>
      ) : null}
      <span className="small muted">{job.progress.message}</span>
      {job.error ? (
        <span className="small field-error" role="alert">
          {job.error.message}
        </span>
      ) : null}
    </div>
  );
}

function SegmentList({ asset }: { asset: MediaAsset }) {
  const api = useApi();
  const segments = useResource(() => api.media.segments(asset.id), [api, asset.id]);
  return (
    <DataState state={segments} label="proposed plays">
      {(items: PlaySegment[]) => {
        const counts = { proposed: 0, accepted: 0, rejected: 0 };
        items.forEach((s) => (counts[s.reviewStatus] += 1));
        return (
          <div className="segment-list">
            <p className="small">
              <strong>{items.length}</strong> plays proposed · {counts.accepted} accepted · {counts.proposed} awaiting review · {counts.rejected} rejected. Times are seconds from the start of the
              original file.
            </p>
            {items.length === 0 ? (
              <EmptyState title="No plays proposed yet." />
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Start</th>
                      <th scope="col">End</th>
                      <th scope="col">Origin</th>
                      <th scope="col">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 12).map((s) => (
                      <tr key={s.id}>
                        <td>{s.index}</td>
                        <td className="mono">{formatSeconds(s.startSec)}</td>
                        <td className="mono">{formatSeconds(s.endSec)}</td>
                        <td>{humanize(s.origin)}</td>
                        <td>
                          <StatusBadge value={s.reviewStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {items.length > 12 ? <p className="small muted">Showing the first 12 of {items.length}. The play-by-play review screen is the next milestone.</p> : null}
          </div>
        );
      }}
    </DataState>
  );
}

export function FilmPage() {
  const api = useApi();
  const ws = useWorkspace();
  const game = ws.game;
  const team = ws.team;
  const [openAsset, setOpenAsset] = useState<string | null>(null);

  const data = useResource(async () => {
    if (!game || !team) return { assets: [] as MediaAsset[], jobs: [] as ProcessingJob[] };
    const [assets, jobs] = await Promise.all([api.media.assets(game.id), api.media.jobs(team.id)]);
    return { assets, jobs };
  }, [api, game?.id, team?.id]);

  return (
    <>
      <PageHeader title="Our Team Film" lede={game ? <>Film attached to {ws.gameLabel(game)}. Opponent film for the same week lives here too and feeds scouting.</> : 'Pick a game in the context bar.'} />
      {game ? <UploadForm gameId={game.id} onCreated={data.reload} /> : null}
      <DataState state={data} label="film">
        {({ assets, jobs }) =>
          assets.length === 0 ? (
            <EmptyState title="No film for this game yet." />
          ) : (
            <ul className="asset-list">
              {assets.map((a) => {
                const assetJobs = jobs.filter((j) => j.assetId === a.id);
                const ours = a.context.analyzedTeam === 'us';
                return (
                  <li key={a.id} className="card asset">
                    <div className="asset-head">
                      <div>
                        <h2>{a.originalFilename}</h2>
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
                    {a.quality ? (
                      <p className="small">
                        Footage check: stable camera {a.quality.stable === null ? 'not assessed' : a.quality.stable ? 'yes' : 'no'}; line of scrimmage{' '}
                        {a.quality.lineOfScrimmageVisible === null ? 'not assessed' : a.quality.lineOfScrimmageVisible ? 'visible' : 'not visible'}; all 22 players{' '}
                        {a.quality.allTwentyTwoVisible === null ? 'not assessed' : a.quality.allTwentyTwoVisible ? 'visible' : 'not always visible'}.
                        {a.quality.notes.map((n) => ` ${n}`)}
                        {a.quality.unevaluable.length ? ` Could not evaluate: ${a.quality.unevaluable.join('; ')}.` : ''}
                      </p>
                    ) : null}
                    {assetJobs.length ? (
                      <div className="job-list">
                        {assetJobs.map((j) => (
                          <JobProgress key={j.id} job={j} />
                        ))}
                      </div>
                    ) : null}
                    {a.status === 'ready' ? (
                      <div>
                        <button type="button" className="link" aria-expanded={openAsset === a.id} onClick={() => setOpenAsset(openAsset === a.id ? null : a.id)}>
                          {openAsset === a.id ? 'Hide proposed plays' : 'Show proposed plays'}
                        </button>
                        {openAsset === a.id ? <SegmentList asset={a} /> : null}
                      </div>
                    ) : null}
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
