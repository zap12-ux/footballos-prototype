import { useEffect, useId, useState } from 'react';
import { useApi, useAction, useResource } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, SaveStatus, formatBytes, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

const MIB = 1024 ** 2;

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
  useEffect(() => {
    if (settings.data) setRetention(settings.data.retentionDays === null ? '' : String(settings.data.retentionDays));
  }, [settings.data]);

  const save = useAction(async () => {
    if (!teamId || !settings.data) throw new Error('Settings not loaded.');
    const days = retention === '' ? null : Number(retention);
    if (days !== null && (!Number.isInteger(days) || days < 30)) throw new Error('Retention must be blank (keep until deleted) or at least 30 days.');
    const next = await api.teams.updateSettings(teamId, { retentionDays: days, expectedVersion: settings.data.version });
    settings.reload();
    return next;
  });

  return (
    <>
      <PageHeader title="Settings" lede="Team details, media retention and the server's upload limits. Deleting media is an explicit action that writes an audit event; nothing is removed silently." />
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
        <h2 id="retention-heading">Media retention</h2>
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
                </div>
                <p className="small muted">Current: {s.retentionDays === null ? 'keep until deleted' : `${s.retentionDays} days`}. Settings version {s.version}.</p>
                <dl className="kv" data-testid="upload-limits">
                  <dt>Largest upload</dt>
                  <dd>{formatBytes(s.uploadLimits.maxUploadBytes)}</dd>
                  <dt>Upload chunk</dt>
                  <dd>{Math.round(s.uploadLimits.uploadChunkBytes / MIB)} MB per request</dd>
                  <dt>Accepted containers</dt>
                  <dd>{s.uploadLimits.allowedVideoContainers.join(', ') || 'none'}</dd>
                  <dt>Unfinished uploads kept for</dt>
                  <dd>{s.uploadLimits.uploadTtlHours} hours</dd>
                </dl>
                <p className="small muted">Upload limits come from the server's configuration (<code>MAX_UPLOAD_BYTES</code>, <code>UPLOAD_CHUNK_BYTES</code>, <code>ALLOWED_VIDEO_CONTAINERS</code>, <code>UPLOAD_TTL_HOURS</code>) and are shown here, not edited.</p>
                {isHead ? (
                  <div className="btn-row">
                    <button type="submit" className="primary" disabled={save.status === 'saving'}>
                      Save retention
                    </button>
                    <SaveStatus status={save.status} error={save.error} />
                  </div>
                ) : (
                  <p className="small muted">Only the head coach can change retention.</p>
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
