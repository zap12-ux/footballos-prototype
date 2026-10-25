import { useEffect, useId, useState } from 'react';
import { useApi, useAction, useResource } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, SaveStatus, formatBytes, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/**
 * Settings (CONTRACTS §14.7): `GET/PATCH /teams/:teamId/settings` with `expectedVersion`.
 * Only the head coach edits; a stale version is reported as a conflict, never overwritten.
 */
export function SettingsPage() {
  const api = useApi();
  const ws = useWorkspace();
  const me = useMe();
  const id = useId();
  const teamId = ws.team?.id ?? null;
  const isHead = me.memberships.some((m) => m.teamId === teamId && m.role === 'head_coach');
  const settings = useResource(async () => (teamId ? api.teams.settings(teamId) : null), [api, teamId]);

  const [retention, setRetention] = useState<string>('');
  const [maxGb, setMaxGb] = useState<string>('');
  const [chunkMb, setChunkMb] = useState<string>('');
  const [containers, setContainers] = useState<string>('');
  useEffect(() => {
    if (settings.data) {
      setRetention(settings.data.retentionDays === null ? '' : String(settings.data.retentionDays));
      setMaxGb(String(Math.round((settings.data.uploadLimits.maxUploadBytes / GIB) * 10) / 10));
      setChunkMb(String(Math.round(settings.data.uploadLimits.chunkBytes / MIB)));
      setContainers(settings.data.uploadLimits.allowedVideoContainers.join(', '));
    }
  }, [settings.data]);

  const save = useAction(async () => {
    if (!teamId || !settings.data) throw new Error('Settings not loaded.');
    const days = retention === '' ? null : Number(retention);
    if (days !== null && (!Number.isInteger(days) || days < 30)) throw new Error('Retention must be blank (keep until deleted) or at least 30 days.');
    const gb = Number(maxGb);
    const mb = Number(chunkMb);
    if (!(gb > 0) || !(mb > 0)) throw new Error('Upload limits must be positive numbers.');
    const allowedVideoContainers = containers.split(',').map((c) => c.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
    if (allowedVideoContainers.length === 0) throw new Error('List at least one video container, e.g. mp4, mov.');
    const next = await api.teams.updateSettings(teamId, {
      retentionDays: days,
      uploadLimits: { maxUploadBytes: Math.round(gb * GIB), chunkBytes: Math.round(mb * MIB), allowedVideoContainers },
      expectedVersion: settings.data.version,
    });
    settings.reload();
    return next;
  });

  return (
    <>
      <PageHeader title="Settings" lede="Team details, media retention and upload limits. Deleting media is an explicit action that writes an audit event; nothing is removed silently." />
      <section className="card" aria-labelledby="team-heading">
        <h2 id="team-heading">Team</h2>
        {ws.team ? (
          <dl className="kv">
            <dt>Name</dt>
            <dd>{ws.team.name}</dd>
            <dt>Level</dt>
            <dd>{humanize(ws.team.level)}</dd>
            <dt>Environment</dt>
            <dd>{humanize(ws.team.environmentKind)}</dd>
            <dt>Time zone</dt>
            <dd>{ws.team.timezone}</dd>
            <dt>Seasons</dt>
            <dd>{ws.seasons.map((s) => `${s.label}${s.isCurrent ? ' (current)' : ''}`).join(', ')}</dd>
          </dl>
        ) : (
          <EmptyState title="No team selected." />
        )}
      </section>
      <section className="card" aria-labelledby="retention-heading">
        <h2 id="retention-heading">Media retention and upload limits</h2>
        <DataState state={settings} label="settings">
          {(s) =>
            !s ? (
              <EmptyState title="No team selected." />
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save.run();
                }}
              >
                <div className="field-grid">
                  <label htmlFor={`${id}-days`}>
                    Keep uploaded film for (days)
                    <input id={`${id}-days`} type="number" min={30} value={retention} onChange={(e) => setRetention(e.target.value)} disabled={!isHead} placeholder="Blank = keep until deleted" />
                  </label>
                  <label htmlFor={`${id}-max`}>
                    Largest upload (GB)
                    <input id={`${id}-max`} type="number" min={0.1} step={0.1} value={maxGb} onChange={(e) => setMaxGb(e.target.value)} disabled={!isHead} />
                  </label>
                  <label htmlFor={`${id}-chunk`}>
                    Upload chunk size (MB)
                    <input id={`${id}-chunk`} type="number" min={1} step={1} value={chunkMb} onChange={(e) => setChunkMb(e.target.value)} disabled={!isHead} />
                  </label>
                  <label htmlFor={`${id}-containers`}>
                    Accepted video containers
                    <input id={`${id}-containers`} type="text" value={containers} onChange={(e) => setContainers(e.target.value)} disabled={!isHead} placeholder="mp4, mov" />
                  </label>
                </div>
                <p className="small muted">
                  Current: {s.retentionDays === null ? 'keep until deleted' : `${s.retentionDays} days`}; uploads up to {formatBytes(s.uploadLimits.maxUploadBytes)} in {formatBytes(s.uploadLimits.chunkBytes)}{' '}
                  chunks; containers {s.uploadLimits.allowedVideoContainers.join(', ') || 'none'}. Settings version {s.version}.
                </p>
                {isHead ? (
                  <div className="btn-row">
                    <button type="submit" className="primary" disabled={save.status === 'saving'}>
                      Save settings
                    </button>
                    <SaveStatus status={save.status} error={save.error} />
                  </div>
                ) : (
                  <p className="small muted">Only the head coach can change retention and limits.</p>
                )}
              </form>
            )
          }
        </DataState>
      </section>
      <section className="card" aria-labelledby="account-heading">
        <h2 id="account-heading">Your account</h2>
        <dl className="kv">
          <dt>Name</dt>
          <dd>{me.user.displayName}</dd>
          <dt>Email</dt>
          <dd>{me.user.email}</dd>
          <dt>Multi-factor sign-in</dt>
          <dd>{me.user.mfaEnabled ? 'On' : 'Off'}</dd>
        </dl>
        <p className="small muted">MFA set-up and recovery codes are managed on the server (<code>/auth/mfa/setup</code>); the screen for it arrives with the API.</p>
      </section>
    </>
  );
}
