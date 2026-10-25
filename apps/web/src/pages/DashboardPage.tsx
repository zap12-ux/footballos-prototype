import { Link } from 'react-router';
import { useApi, useResource } from '../api/hooks';
import { UNIT_LABELS, seasonRecord, type GamePlanVersion, type MediaAsset, type PlaySegment, type ProcessingJob, type Unit } from '../api/contracts';
import { DataState, EmptyState, PageHeader, StatusBadge, formatDateTime, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

interface DashboardData {
  assets: MediaAsset[];
  jobs: ProcessingJob[];
  segments: PlaySegment[];
  plans: { unit: Unit; current: GamePlanVersion | null; unresolved: number }[];
  openInvites: number;
}

export interface OpenTask {
  id: string;
  text: string;
  to: string;
}

export function deriveTasks(data: DashboardData, href: (path: string, patch?: { unit?: Unit }) => string): OpenTask[] {
  const tasks: OpenTask[] = [];
  const proposed = data.segments.filter((s) => s.reviewStatus === 'proposed').length;
  if (proposed > 0) tasks.push({ id: 'segments', text: `${proposed} proposed play cuts are waiting for review.`, to: href('/app/scouting') });
  for (const asset of data.assets) {
    if (asset.status === 'rejected') tasks.push({ id: `rejected-${asset.id}`, text: `Upload "${asset.originalFilename}" was rejected: ${asset.rejectionReason ?? 'no reason recorded'}.`, to: href('/app/film') });
  }
  for (const job of data.jobs) {
    if (job.status === 'failed') tasks.push({ id: `job-${job.id}`, text: `${humanize(job.kind)} job failed: ${job.error?.message ?? 'no detail recorded'}.`, to: href('/app/film') });
  }
  for (const p of data.plans) {
    if (p.current?.status === 'in_review') tasks.push({ id: `plan-${p.unit}`, text: `${UNIT_LABELS[p.unit]} plan version ${p.current.number} is waiting for approval.`, to: href('/app/plans', { unit: p.unit }) });
    if (p.unresolved > 0) tasks.push({ id: `comments-${p.unit}`, text: `${p.unresolved} unresolved comment${p.unresolved === 1 ? '' : 's'} on the ${UNIT_LABELS[p.unit].toLowerCase()} plan.`, to: href('/app/plans', { unit: p.unit }) });
  }
  if (data.openInvites > 0) tasks.push({ id: 'invites', text: `${data.openInvites} staff invitation${data.openInvites === 1 ? '' : 's'} not yet accepted.`, to: href('/app/staff') });
  return tasks;
}

export function DashboardPage() {
  const api = useApi();
  const ws = useWorkspace();
  const team = ws.team;
  const game = ws.game;

  const data = useResource<DashboardData>(async () => {
    if (!team || !game) return { assets: [], jobs: [], segments: [], plans: [], openInvites: 0 };
    const units: Unit[] = ['offense', 'defense', 'special_teams'];
    const [assets, jobs, bundles, staff] = await Promise.all([
      api.media.assets(game.id),
      api.media.jobs(team.id),
      Promise.all(units.map((u) => api.plans.get(game.id, u))),
      api.teams.staff(team.id),
    ]);
    const ready = assets.find((a) => a.status === 'ready');
    const segments = ready ? await api.media.segments(ready.id) : [];
    const plans = bundles.map((b, i) => {
      const current = b.versions.find((v) => v.id === b.plan.currentVersionId) ?? null;
      const unresolved = b.comments.filter((c) => !c.resolvedAt && current && c.versionId === current.id).length;
      return { unit: units[i], current, unresolved };
    });
    return { assets, jobs, segments, plans, openInvites: staff.invites.length };
  }, [api, team?.id, game?.id]);

  const record = seasonRecord(ws.games);

  return (
    <>
      <PageHeader
        title="Dashboard"
        lede={
          <>
            {team?.name} · {ws.season?.label} season · record {record.wins}–{record.losses}
            {record.ties ? `–${record.ties}` : ''} ({ws.games.filter((g) => g.status === 'final').length} final games)
          </>
        }
      />
      <section className="card this-week" aria-labelledby="this-week-heading">
        <h2 id="this-week-heading">This week&rsquo;s game</h2>
        {game ? (
          <div className="this-week-body">
            <p className="game-title">{ws.gameLabel(game)}</p>
            <p>
              {formatDateTime(game.scheduledAt, team?.timezone)} · {game.location ? humanize(game.location) : 'Location not set'} · <StatusBadge value={game.status} />
            </p>
            {game.notes ? <p className="small muted">{game.notes}</p> : null}
            <p className="btn-row">
              <Link className="btn" to={ws.href('/app/scouting')}>
                Opponent scouting
              </Link>
              <Link className="btn" to={ws.href('/app/plans')}>
                Game plans
              </Link>
              <Link className="btn" to={ws.href('/app/schedule')}>
                Schedule
              </Link>
            </p>
          </div>
        ) : (
          <EmptyState title="No game selected">
            <p className="small">
              Add games on the <Link to={ws.href('/app/schedule')}>schedule</Link> and pick one in the context bar.
            </p>
          </EmptyState>
        )}
      </section>

      <DataState state={data} label="this week's work">
        {(d) => {
          const tasks = deriveTasks(d, ws.href);
          return (
            <div className="dash-grid">
              <section className="card" aria-labelledby="tasks-heading">
                <h2 id="tasks-heading">Open tasks</h2>
                {tasks.length === 0 ? (
                  <EmptyState title="Nothing is waiting on you." />
                ) : (
                  <ul className="task-list">
                    {tasks.map((t) => (
                      <li key={t.id}>
                        <Link to={t.to}>{t.text}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card" aria-labelledby="film-heading">
                <h2 id="film-heading">Recent film</h2>
                {d.assets.length === 0 ? (
                  <EmptyState title="No film uploaded for this game yet.">
                    <p className="small">
                      <Link to={ws.href('/app/film')}>Upload film</Link>
                    </p>
                  </EmptyState>
                ) : (
                  <ul className="film-list">
                    {d.assets.slice(0, 4).map((a) => {
                      const job = d.jobs.find((j) => j.assetId === a.id && (j.status === 'running' || j.status === 'queued'));
                      return (
                        <li key={a.id}>
                          <span className="file-name">{a.originalFilename}</span>
                          <span className="small muted">
                            {a.context.analyzedTeam === 'us' ? 'Our film' : 'Opponent film'} · {humanize(a.context.perspective)}
                          </span>
                          <span>
                            <StatusBadge value={a.status} />
                            {job ? (
                              <span className="small muted">
                                {' '}
                                {job.progress.message}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="card" aria-labelledby="plans-heading">
                <h2 id="plans-heading">Plan status</h2>
                <ul className="plan-status-list">
                  {d.plans.map((p) => (
                    <li key={p.unit}>
                      <Link to={ws.href('/app/plans', { unit: p.unit })}>{UNIT_LABELS[p.unit]}</Link>
                      {p.current ? (
                        <span>
                          <StatusBadge value={p.current.status} /> <span className="small muted">version {p.current.number}</span>
                        </span>
                      ) : (
                        <span className="small muted">No plan yet</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          );
        }}
      </DataState>
    </>
  );
}
