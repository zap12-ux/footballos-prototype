import { useEffect, useId, useState } from 'react';
import { useApi, useAction, useResource } from '../api/hooks';
import { ApiError, type GamePlanBundle } from '../api';
import { UNIT_LABELS, type GamePlanVersion, type PlanComment, type PlanSection, type StaffMembership, type Unit } from '../api/contracts';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, SaveStatus, StatusBadge, formatDateTime } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { draftKeys, draftStore, useDraft, useDrafts, type PlanCommentDraft } from '../workspace/drafts';

/**
 * One section of a plan version. The Add field's text is a draft (HC-01, OC-10): it stays
 * where the coach left it across unit tabs and workspace navigation until it is added,
 * emptied, or the version is saved.
 */
function SectionEditor({ section, editable, draftKey, onChange }: { section: PlanSection; editable: boolean; draftKey: string; onChange: (next: PlanSection) => void }) {
  const [draft, setDraft, clearDraft] = useDraft<string>(draftKey);
  const text = draft ?? '';
  const id = useId();
  return (
    <section className="plan-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>
        {section.title} <span className="small muted">({section.items.length})</span>
      </h3>
      {section.items.length === 0 ? <p className="small muted">Nothing in this section yet.</p> : null}
      <ol className="plan-items">
        {section.items.map((item) => (
          <li key={item.id}>
            <span>{item.text}</span>
            {item.sourceRecommendationId ? <span className="tag gold">from recommendation</span> : null}
            {editable ? (
              <button type="button" className="link small" onClick={() => onChange({ ...section, items: section.items.filter((i) => i.id !== item.id).map((i, n) => ({ ...i, order: n + 1 })) })}>
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {editable ? (
        <form
          className="add-item"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onChange({
              ...section,
              items: [...section.items, { id: `${section.key}-${Date.now().toString(36)}`, text: text.trim(), sourceRecommendationId: null, conceptIds: [], packageIds: [], order: section.items.length + 1 }],
            });
            clearDraft();
          }}
        >
          <label htmlFor={`${id}-add`} className="sr-only">
            Add to {section.title}
          </label>
          <input id={`${id}-add`} type="text" value={text} onChange={(e) => (e.target.value === '' ? clearDraft() : setDraft(e.target.value))} placeholder={`Add to ${section.title.toLowerCase()}`} />
          <button type="submit">Add</button>
          {text.trim() ? (
            <span className="small muted" data-testid="add-field-pending">
              not added yet
            </span>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

/** The comment form keeps its text and target section as a draft until posted or discarded (PC-05). */
function CommentsPanel({ teamId, version, comments, authorName, onPosted }: { teamId: string; version: GamePlanVersion; comments: PlanComment[]; authorName: (id: string) => string; onPosted: () => void }) {
  const api = useApi();
  const id = useId();
  const [draft, setDraft, clearDraft] = useDraft<PlanCommentDraft>(draftKeys.planComment(teamId, version.id));
  const body = draft?.body ?? '';
  const sectionKey = draft?.sectionKey ?? '';
  const update = (patch: Partial<PlanCommentDraft>) => {
    const next = { sectionKey, body, ...patch };
    if (next.body === '' && next.sectionKey === '') clearDraft();
    else setDraft(next);
  };
  const post = useAction(async () => {
    const c = await api.plans.comment(version.id, { sectionKey: sectionKey || null, itemId: null, body });
    clearDraft();
    onPosted();
    return c;
  });
  const open = comments.filter((c) => !c.resolvedAt);
  const resolved = comments.filter((c) => c.resolvedAt);
  return (
    <aside className="card comments" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>
        Comments <span className="small muted">({open.length} open)</span>
      </h2>
      {comments.length === 0 ? <p className="small muted">No comments on version {version.number}.</p> : null}
      <ul className="comment-list">
        {[...open, ...resolved].map((c) => (
          <li key={c.id} className={c.resolvedAt ? 'resolved' : undefined}>
            <p className="small">
              <strong>{authorName(c.authorUserId)}</strong> · {formatDateTime(c.createdAt)}
              {c.sectionKey ? ` · ${version.sections.find((s) => s.key === c.sectionKey)?.title ?? c.sectionKey}` : ''}
              {c.resolvedAt ? ' · resolved' : ''}
            </p>
            <p>{c.body}</p>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void post.run();
        }}
      >
        <label htmlFor={`${id}-section`}>On section</label>
        <select id={`${id}-section`} value={sectionKey} onChange={(e) => update({ sectionKey: e.target.value })}>
          <option value="">Whole plan</option>
          {version.sections.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-body`}>Comment</label>
        <textarea id={`${id}-body`} value={body} onChange={(e) => update({ body: e.target.value })} rows={3} />
        <div className="btn-row">
          <button type="submit" disabled={post.status === 'saving' || !body.trim()}>
            Post comment
          </button>
          {body.trim() ? (
            <>
              <span className="small muted" data-testid="comment-draft-kept">
                Unposted comment kept on v{version.number} until you post or discard it.
              </span>
              <button type="button" className="link small" onClick={clearDraft}>
                Discard comment
              </button>
            </>
          ) : null}
          <SaveStatus status={post.status} error={post.error} savedText="Posted" />
        </div>
      </form>
    </aside>
  );
}

/**
 * Who approved a version, when, and whether it was overridden and why; shown for approved
 * and superseded versions alike, since the history is never cleared (HC-03, D-014).
 */
function ApprovalHistory({ version, versions, authorName }: { version: GamePlanVersion; versions: GamePlanVersion[]; authorName: (id: string) => string }) {
  if (version.status !== 'approved' && version.status !== 'superseded') return null;
  const by = version.supersededByVersionId ? versions.find((v) => v.id === version.supersededByVersionId) : undefined;
  return (
    <p className="small approval-history" data-testid="approval-history">
      Approved {formatDateTime(version.approvedAt)} by {version.approvedBy ? authorName(version.approvedBy) : 'unknown'}
      {version.override ? <> · head-coach override{version.overrideReason ? <>: “{version.overrideReason}”</> : ' (no reason recorded)'}</> : ''}
      {version.status === 'superseded' ? (
        <>
          {' '}· Superseded {formatDateTime(version.supersededAt)}
          {by ? <> by v{by.number} (approved by {by.approvedBy ? authorName(by.approvedBy) : 'unknown'}{by.override ? ', head-coach override' : ''})</> : ''}
        </>
      ) : null}
    </p>
  );
}

function PlanBody({
  data,
  teamId,
  unit,
  membership,
  viewing,
  onView,
  reload,
  authorName,
}: {
  data: GamePlanBundle;
  teamId: string;
  unit: Unit;
  membership: StaffMembership | undefined;
  viewing: string | null;
  onView: (versionId: string) => void;
  reload: () => void;
  authorName: (id: string) => string;
}) {
  const api = useApi();
  const version = data.versions.find((v) => v.id === viewing) ?? data.versions.find((v) => v.id === data.plan.currentVersionId) ?? data.versions[data.versions.length - 1];
  const canEdit = !!membership && (membership.role === 'head_coach' || ((membership.role === 'coordinator' || membership.role === 'position_coach') && membership.units.includes(unit)));
  const canApprove = !!membership && (membership.role === 'head_coach' || (membership.role === 'coordinator' && membership.units.includes(unit)));
  // CONTRACTS §3: a head coach's approval is recorded as an override, whatever units they list.
  const isOverride = membership?.role === 'head_coach';
  const editable = canEdit && version.status === 'draft';
  const [approving, setApproving] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [routed, setRouted] = useState<string | null>(null);

  // Section edits are a draft keyed by version (HC-01, OC-10): they outlive unit switches and navigation.
  const sectionsKey = draftKeys.planSections(teamId, version.id);
  const [draftSections, setDraftSections, clearDraftSections] = useDraft<PlanSection[]>(sectionsKey);
  const drafts = useDrafts();
  const addPrefix = draftKeys.planAddFieldPrefix(teamId, version.id);
  const pendingAddFields = Object.entries(drafts).filter(([k, v]) => k.startsWith(addPrefix) && typeof v === 'string' && v.trim() !== '').length;
  const dirty = draftSections !== undefined;
  const hasUnsaved = editable && (dirty || pendingAddFields > 0);
  const shown = editable && draftSections ? draftSections : version.sections;
  const comments = data.comments.filter((c) => c.versionId === version.id);

  function discardAll() {
    clearDraftSections();
    draftStore.clearPrefix(addPrefix);
  }

  const save = useAction(async (v: GamePlanVersion) => {
    const next = await api.plans.update(v.id, { sections: draftSections ?? v.sections, expectedVersion: v.version });
    clearDraftSections();
    reload();
    return next;
  });
  const submit = useAction(async (v: GamePlanVersion) => {
    const next = await api.plans.submit(v.id);
    reload();
    return next;
  });
  const approve = useAction(async (v: GamePlanVersion) => {
    const reason = overrideReason.trim();
    if (isOverride && !reason) throw new Error('A head-coach override needs a reason; it is kept with the version and in the audit log.');
    const next = await api.plans.approve(v.id, isOverride ? { overrideReason: reason } : {});
    setApproving(false);
    setOverrideReason('');
    reload();
    return next;
  });
  // One draft per unit and game (HC-07): an existing draft is opened and named, never duplicated.
  const newDraft = useAction(async (v: GamePlanVersion) => {
    const existing = data.versions.find((x) => x.status === 'draft');
    if (existing) {
      onView(existing.id);
      setRouted(`v${existing.number} is already this unit's open draft; opened it instead of creating another.`);
      return existing;
    }
    try {
      const next = await api.plans.createDraft(v.id);
      setRouted(null);
      reload();
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && typeof error.details.versionId === 'string') {
        const open = data.versions.find((x) => x.id === error.details.versionId);
        onView(error.details.versionId);
        setRouted(`${open ? `v${open.number}` : 'A draft'} is already this unit's open draft; opened it instead of creating another.`);
        reload();
        return open;
      }
      throw error;
    }
  });

  return (
    <div className="plan-layout">
      <div className="plan-main">
        <div className="plan-toolbar">
          <label>
            Version
            <select value={version.id} onChange={(e) => onView(e.target.value)}>
              {data.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.number} · {v.status.replace('_', ' ')}
                  {v.id === data.plan.currentVersionId ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
          <StatusBadge value={version.status} />
          {version.basedOn ? <span className="small muted">Based on v{data.versions.find((v) => v.id === version.basedOn)?.number ?? '?'}</span> : null}
        </div>
        <ApprovalHistory version={version} versions={data.versions} authorName={authorName} />
        {routed ? (
          <p className="callout small" role="status" data-testid="draft-routed">
            {routed}
          </p>
        ) : null}
        <div className="btn-row plan-actions">
          {editable ? (
            <button type="button" className="primary" disabled={!dirty || save.status === 'saving'} onClick={() => void save.run(version)}>
              {save.status === 'saving' ? 'Saving…' : dirty ? 'Save draft' : 'Draft saved'}
            </button>
          ) : null}
          {hasUnsaved ? (
            <>
              <span className="tag gold" data-testid="unsaved-indicator" role="status">
                Unsaved changes
                {pendingAddFields ? ` · ${pendingAddFields} Add field${pendingAddFields === 1 ? '' : 's'} not added` : ''}
              </span>
              <button type="button" className="link small" onClick={discardAll}>
                Discard changes
              </button>
            </>
          ) : null}
          {editable ? (
            <button
              type="button"
              disabled={dirty || pendingAddFields > 0 || submit.status === 'saving'}
              onClick={() => void submit.run(version)}
              title={dirty ? 'Save the draft first' : pendingAddFields > 0 ? 'Add or clear the text still in an Add field first' : undefined}
            >
              Submit for review
            </button>
          ) : null}
          {canApprove && (version.status === 'in_review' || version.status === 'draft') ? (
            <button type="button" className="accept" disabled={approve.status === 'saving' || (isOverride && approving)} onClick={() => (isOverride ? setApproving(true) : void approve.run(version))}>
              Approve v{version.number}
              {isOverride ? ' (override)' : ''}
            </button>
          ) : null}
          {canEdit && version.status === 'approved' ? (
            <button type="button" disabled={newDraft.status === 'saving'} onClick={() => void newDraft.run(version)}>
              Start a new draft from v{version.number}
            </button>
          ) : null}
          <SaveStatus status={save.status} error={save.error} />
          <SaveStatus status={submit.status} error={submit.error} savedText="Submitted for review" />
          <SaveStatus status={approve.status} error={approve.error} savedText="Approved" />
          <SaveStatus status={newDraft.status} error={newDraft.error} savedText={routed ? 'Opened the existing draft' : 'Draft created'} />
        </div>
        {approving && isOverride && (version.status === 'in_review' || version.status === 'draft') ? (
          <form
            className="callout override-form"
            data-testid="override-form"
            onSubmit={(e) => {
              e.preventDefault();
              void approve.run(version);
            }}
          >
            <p className="small">
              <strong>Head-coach override.</strong> Approving v{version.number} yourself supersedes the current approved version. The reason is kept with this version and in the audit log so staff can reconstruct it later.
            </p>
            <label htmlFor={`${sectionsKey}-reason`} className="small">
              Reason for the override (required)
            </label>
            <input id={`${sectionsKey}-reason`} type="text" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="What changed and why it cannot wait for the coordinator" />
            <div className="btn-row">
              <button type="submit" className="accept" disabled={!overrideReason.trim() || approve.status === 'saving'}>
                Confirm override approval
              </button>
              <button type="button" onClick={() => { setApproving(false); setOverrideReason(''); approve.reset(); }}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {!editable && draftSections ? (
          <p className="callout warn small" role="alert" data-testid="stale-draft">
            You have unsaved edits to v{version.number} from before it became {version.status.replace('_', ' ')}; they were not applied and are kept here until you discard them.{' '}
            <button type="button" className="link small" onClick={discardAll}>
              Discard those edits
            </button>
          </p>
        ) : null}
        {!canEdit ? <p className="small muted">You can read and comment on this plan; editing is limited to the unit&rsquo;s coaches and the head coach.</p> : null}
        <div className="plan-sections">
          {shown.map((section) => (
            <SectionEditor
              key={section.key}
              section={section}
              editable={editable}
              draftKey={draftKeys.planAddField(teamId, version.id, section.key)}
              onChange={(next) => setDraftSections(shown.map((s) => (s.key === next.key ? next : s)))}
            />
          ))}
        </div>
      </div>
      <CommentsPanel teamId={teamId} version={version} comments={comments} authorName={authorName} onPosted={reload} />
    </div>
  );
}

export function PlansPage() {
  const api = useApi();
  const ws = useWorkspace();
  const me = useMe();
  const units: Unit[] = ['offense', 'defense', 'special_teams'];
  const game = ws.game;

  const bundle = useResource(async () => {
    if (!game) return null;
    return api.plans.get(game.id, ws.unit);
  }, [api, game?.id, ws.unit]);

  const [viewing, setViewing] = useState<string | null>(null);

  // Open on the current version when the plan changes; drafts are keyed by version and survive this.
  const currentVersionId = bundle.data?.plan.currentVersionId ?? null;
  useEffect(() => {
    setViewing(currentVersionId);
  }, [currentVersionId, ws.unit, game?.id]);

  const staff = useResource(async () => (ws.team ? api.teams.staff(ws.team.id) : null), [api, ws.team?.id]);
  const authorName = (userId: string) => staff.data?.members.find((m) => m.userId === userId)?.user.displayName ?? 'Staff member';
  const membership = me.memberships.find((m) => m.teamId === ws.team?.id);

  return (
    <>
      <PageHeader title="Weekly Game Plans" lede={game ? <>{ws.gameLabel(game)} · one plan per unit; approved versions are immutable and edits start a new draft.</> : 'Pick a game in the context bar.'}>
        <div role="tablist" aria-label="Unit" className="unit-tabs">
          {units.map((u) => (
            <button key={u} type="button" role="tab" aria-selected={ws.unit === u} className="chip" onClick={() => ws.select({ unit: u })}>
              {UNIT_LABELS[u]}
            </button>
          ))}
        </div>
      </PageHeader>
      <DataState state={bundle} label="the game plan">
        {(data) => {
          if (!data || !ws.team) return <EmptyState title="No game selected." />;
          return <PlanBody data={data} teamId={ws.team.id} unit={ws.unit} membership={membership} viewing={viewing} onView={setViewing} reload={bundle.reload} authorName={authorName} />;
        }}
      </DataState>
    </>
  );
}
