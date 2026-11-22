import { useEffect, useId, useState } from 'react';
import type { Api } from '../api/api';
import { useApi, useAction, useResource } from '../api/hooks';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, SaveStatus, formatBytes, formatDateTime, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

const MIB = 1024 ** 2;

/** What a demo reset clears, named in the confirmation so nobody loses work by surprise. */
const RESET_CLEARS = [
  'plan versions, approvals and comments added or changed here',
  'label corrections, revisions and accepted, rejected, split or merged plays',
  'uploads and their processing jobs',
  'invitations, schedule edits and imports',
  'saved scouting snapshots and settings changes',
];

/**
 * Demo-only (mock mode, demo team): changes made in this browser persist across reloads
 * (iteration 1, OC-01 / PC-04); this card says so and offers the one way to clear them.
 */
function DemoDataCard({ api, timeZone, onReset }: { api: Api; timeZone?: string; onReset: () => void }) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const demo = api.demo!;
  const savedAt = demo.savedAt();
  const reset = useAction(async () => {
    await demo.reset();
    setConfirming(false);
    onReset();
  });
  return (
    <section className="card" aria-labelledby={`${id}-h`} data-testid="demo-data">
      <h2 id={`${id}-h`}>Demo data</h2>
      <p className="small">
        {demo.persisted
          ? savedAt
            ? `Changes made in this browser are kept across reloads; last saved ${formatDateTime(savedAt, timeZone)}.`
            : 'Changes made in this browser are kept across reloads; nothing has been changed since the seed.'
          : 'Changes are kept in memory only for this page.'}{' '}
        Every record is fictional. Resetting returns the seed data; your sign-in and anything you have typed but not saved are kept.
      </p>
      <div className="btn-row">
        <button type="button" onClick={() => setConfirming(true)} disabled={reset.status === 'saving'}>
          Reset demo data
        </button>
        <SaveStatus status={reset.status} error={reset.error} savedText="Demo data reset to the seed" />
      </div>
      {confirming ? (
        <div className="dialog-backdrop">
          <div role="dialog" aria-modal="true" aria-labelledby={`${id}-dh`} className="dialog card">
            <h3 id={`${id}-dh`}>Reset the demo workspace?</h3>
            <p>This clears, for this browser only:</p>
            <ul className="small" data-testid="reset-clears">
              {RESET_CLEARS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="small muted">The seed data returns. Your sign-in and unsaved drafts you have typed are kept.</p>
            <div className="btn-row">
              <button type="button" className="primary" onClick={() => void reset.run()} disabled={reset.status === 'saving'}>
                Reset to seed
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

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
      {ws.team?.environmentKind === 'demo' && api.demo ? (
        <DemoDataCard
          api={api}
          timeZone={ws.team.timezone}
          onReset={() => {
            ws.reload();
            settings.reload();
          }}
        />
      ) : null}
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
