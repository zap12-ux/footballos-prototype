import { useEffect, useId, useState } from 'react';
import { useApi, useAction, useResource } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, SaveStatus, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

export function SettingsPage() {
  const api = useApi();
  const ws = useWorkspace();
  const me = useMe();
  const id = useId();
  const teamId = ws.team?.id ?? null;
  const isHead = me.memberships.some((m) => m.teamId === teamId && m.role === 'head_coach');
  const settings = useResource(async () => (teamId ? api.teams.settings(teamId) : null), [api, teamId]);

  const [retention, setRetention] = useState<string>('');
  const [autoDelete, setAutoDelete] = useState(false);
  useEffect(() => {
    if (settings.data) {
      setRetention(settings.data.retentionDays === null ? '' : String(settings.data.retentionDays));
      setAutoDelete(settings.data.autoDeleteOriginals);
    }
  }, [settings.data]);

  const save = useAction(async () => {
    if (!teamId || !settings.data) throw new Error('Settings not loaded.');
    const days = retention === '' ? null : Number(retention);
    if (days !== null && (!Number.isInteger(days) || days < 30)) throw new Error('Retention must be blank (keep until deleted) or at least 30 days.');
    const next = await api.teams.updateSettings(teamId, { retentionDays: days, autoDeleteOriginals: autoDelete, expectedVersion: settings.data.version });
    settings.reload();
    return next;
  });

  return (
    <>
      <PageHeader title="Settings" lede="Team details and media retention. Deleting media is an explicit action that writes an audit event; nothing is removed silently." />
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
                  <label className="check">
                    <input type="checkbox" checked={autoDelete} onChange={(e) => setAutoDelete(e.target.checked)} disabled={!isHead} /> Delete original files after the retention period (proxies and labels are kept)
                  </label>
                </div>
                <p className="small muted">Current: {s.retentionDays === null ? 'keep until deleted' : `${s.retentionDays} days`}; originals {s.autoDeleteOriginals ? 'are' : 'are not'} deleted automatically. Settings version {s.version}.</p>
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
        <p className="small muted">MFA set-up and recovery codes are managed on the server (`/auth/mfa/setup`); the screen for it arrives with the API.</p>
      </section>
    </>
  );
}
