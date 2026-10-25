import { useEffect, useState } from 'react';
import { useApi, useAction, useResource } from '../api/hooks';
import { UNIT_LABELS, type Concept, type Unit } from '../api/contracts';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, SaveStatus, StatusBadge, formatDate, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

function ConceptRow({ concept, canDecide, onDecided }: { concept: Concept; canDecide: boolean; onDecided: () => void }) {
  const api = useApi();
  const decide = useAction(async (status: 'approved' | 'rejected') => {
    const next = await api.playbook.decideConcept(concept.id, { status, expectedVersion: concept.version });
    onDecided();
    return next;
  });
  return (
    <li className={`concept status-${concept.status}`}>
      <div className="concept-head">
        <h3>
          {concept.name} <span className="tag">{humanize(concept.kind)}</span> <StatusBadge value={concept.status} />
          {concept.installed ? <span className="tag gold">installed</span> : null}
        </h3>
      </div>
      <p>{concept.description}</p>
      {concept.sources.length ? (
        <p className="small muted">
          Source: {concept.sources.map((s) => `page ${s.pageNumber}${s.excerpt ? ` — “${s.excerpt}”` : ''}`).join('; ')}. Extracted text is unreviewed until a coach approves it.
        </p>
      ) : null}
      {concept.status === 'proposed' && canDecide ? (
        <div className="btn-row">
          <button type="button" className="accept" disabled={decide.status === 'saving'} onClick={() => void decide.run('approved')}>
            Approve
          </button>
          <button type="button" className="danger" disabled={decide.status === 'saving'} onClick={() => void decide.run('rejected')}>
            Reject
          </button>
          <SaveStatus status={decide.status} error={decide.error} />
        </div>
      ) : null}
    </li>
  );
}

export function PlaybookPage() {
  const api = useApi();
  const ws = useWorkspace();
  const me = useMe();
  const units: Unit[] = ['offense', 'defense', 'special_teams'];
  const teamId = ws.team?.id ?? null;

  const data = useResource(async () => {
    if (!teamId) return null;
    const [documents, versions] = await Promise.all([api.playbook.documents(teamId, ws.unit), api.playbook.versions(teamId, ws.unit)]);
    return { documents, versions };
  }, [api, teamId, ws.unit]);

  const [versionId, setVersionId] = useState<string | null>(null);
  const defaultVersion = data.data?.versions.find((v) => v.status === 'draft')?.id ?? data.data?.versions.find((v) => v.status === 'approved')?.id ?? null;
  useEffect(() => {
    setVersionId(defaultVersion);
  }, [defaultVersion, ws.unit]);

  const concepts = useResource(async () => (versionId ? api.playbook.concepts(versionId) : []), [api, versionId]);
  const membership = me.memberships.find((m) => m.teamId === teamId);
  const canDecide = !!membership && (membership.role === 'head_coach' || (membership.role === 'coordinator' && membership.units.includes(ws.unit)));

  return (
    <>
      <PageHeader title="Playbook" lede="Documents are uploaded, pages are extracted, and every concept or term is a proposal until a coach approves it. Approved playbook versions are frozen; changes make a new version.">
        <div role="tablist" aria-label="Unit" className="unit-tabs">
          {units.map((u) => (
            <button key={u} type="button" role="tab" aria-selected={ws.unit === u} className="chip" onClick={() => ws.select({ unit: u })}>
              {UNIT_LABELS[u]}
            </button>
          ))}
        </div>
      </PageHeader>
      <DataState state={data} label="the playbook">
        {(d) =>
          !d ? (
            <EmptyState title="No team selected." />
          ) : (
            <div className="playbook-layout">
              <section className="card" aria-labelledby="docs-heading">
                <h2 id="docs-heading">Documents</h2>
                {d.documents.length === 0 ? (
                  <EmptyState title={`No ${UNIT_LABELS[ws.unit].toLowerCase()} documents uploaded.`} />
                ) : (
                  <ul className="doc-list">
                    {d.documents.map((doc) => (
                      <li key={doc.id}>
                        <strong>{doc.title}</strong>
                        <span className="small muted">
                          {doc.pageCount} pages · uploaded {formatDate(doc.createdAt)}
                        </span>
                        <StatusBadge value={doc.status} />
                        {doc.status === 'extracting' ? (
                          <span className="small muted" role="status">
                            Extraction running; concepts will appear as proposals.
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="small muted">Document upload uses the same resumable upload as film; it is wired in the next milestone.</p>
              </section>

              <section className="card" aria-labelledby="versions-heading">
                <h2 id="versions-heading">Versions</h2>
                {d.versions.length === 0 ? (
                  <EmptyState title="No playbook version yet." />
                ) : (
                  <ul className="version-list">
                    {d.versions.map((v) => (
                      <li key={v.id}>
                        <button type="button" className={`link${versionId === v.id ? ' current' : ''}`} aria-pressed={versionId === v.id} onClick={() => setVersionId(v.id)}>
                          {v.label}
                        </button>{' '}
                        <StatusBadge value={v.status} />
                        {v.approvedAt ? <span className="small muted"> approved {formatDate(v.approvedAt)}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card concepts" aria-labelledby="concepts-heading">
                <h2 id="concepts-heading">Concepts {versionId ? `in ${d.versions.find((v) => v.id === versionId)?.label ?? ''}` : ''}</h2>
                <DataState state={concepts} label="concepts">
                  {(items) => {
                    const proposed = items.filter((c) => c.status === 'proposed');
                    const approved = items.filter((c) => c.status === 'approved');
                    const rejected = items.filter((c) => c.status === 'rejected');
                    return items.length === 0 ? (
                      <EmptyState title="No concepts in this version." />
                    ) : (
                      <>
                        <h3 className="group-head">Proposed ({proposed.length})</h3>
                        {proposed.length === 0 ? <p className="small muted">Nothing waiting for a decision.</p> : null}
                        <ul className="concept-list">
                          {proposed.map((c) => (
                            <ConceptRow key={c.id} concept={c} canDecide={canDecide} onDecided={concepts.reload} />
                          ))}
                        </ul>
                        <h3 className="group-head">Approved ({approved.length})</h3>
                        <ul className="concept-list">
                          {approved.map((c) => (
                            <ConceptRow key={c.id} concept={c} canDecide={canDecide} onDecided={concepts.reload} />
                          ))}
                        </ul>
                        {rejected.length ? (
                          <>
                            <h3 className="group-head">Rejected ({rejected.length})</h3>
                            <ul className="concept-list">
                              {rejected.map((c) => (
                                <ConceptRow key={c.id} concept={c} canDecide={canDecide} onDecided={concepts.reload} />
                              ))}
                            </ul>
                          </>
                        ) : null}
                      </>
                    );
                  }}
                </DataState>
              </section>
            </div>
          )
        }
      </DataState>
    </>
  );
}
