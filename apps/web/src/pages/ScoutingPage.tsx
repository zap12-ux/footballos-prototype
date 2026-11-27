import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useApi, useAction, useResource } from '../api/hooks';
import { UNIT_LABELS, type EvidenceRef, type ReviewBasis, type ScoutingFinding, type Unit } from '../api/contracts';
import { DataState, EmptyState, PageHeader, SaveStatus, formatDate, formatDateTime, formatSeconds, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

/** `/app/film/:assetId?…&t=<sec>`: the asset view opens the player at that time. */
export function evidenceHref(href: (path: string) => string, evidence: Pick<EvidenceRef, 'assetId' | 'atSec'>): string {
  const base = href(`/app/film/${evidence.assetId}`);
  return `${base}${base.includes('?') ? '&' : '?'}t=${evidence.atSec}`;
}

/** "play 33" for an id that ends in a number, otherwise a short id, so an excluded segment is nameable. */
function segmentName(id: string): string {
  const m = /-(\d+)$/.exec(id);
  return m ? `play ${m[1]}` : id.slice(0, 8);
}

/**
 * Evidence links for one finding. A finding with no supporting play says so in place of the
 * link (OC-06): a card never looks backed when it is not. Contrary examples stay under
 * "Against" and never stand in for support.
 */
function EvidenceList({ label, items, href, emptyText }: { label: string; items: EvidenceRef[]; href: (path: string) => string; emptyText?: string }) {
  if (!items.length) {
    if (!emptyText) return null;
    return (
      <p className="small evidence-list">
        <span className="muted">{label}: </span>
        <span className="tag low" data-testid="no-supporting-play">
          {emptyText}
        </span>
      </p>
    );
  }
  return (
    <p className="small evidence-list" data-testid={label === 'Against' ? 'contrary-evidence' : 'supporting-evidence'}>
      <span className="muted">{label}: </span>
      {items.map((e, i) => (
        <span key={`${e.assetId}-${e.atSec}-${i}`}>
          {i > 0 ? ' · ' : ''}
          <Link to={evidenceHref(href, e)} title="Open the film at this moment">
            {formatSeconds(e.atSec)}
          </Link>
          {e.note ? ` ${e.note}` : ''}
        </span>
      ))}
    </p>
  );
}

export function FindingCard({ finding, href }: { finding: ScoutingFinding; href: (path: string) => string }) {
  const excluded = Object.entries(finding.excludedReason);
  return (
    <article className={`card finding kind-${finding.kind}`} aria-labelledby={`${finding.id}-h`}>
      <div className="finding-head">
        <span className="tag">{humanize(finding.kind)}</span>
        <span className={`tag ${finding.reviewBasis === 'reviewed_only' ? 'high' : 'medium'}`} data-testid="review-basis">
          {finding.reviewBasis === 'reviewed_only' ? 'Reviewed labels only' : 'Includes unreviewed labels'}
        </span>
      </div>
      <h3 id={`${finding.id}-h`}>{finding.statement}</h3>
      <p className="finding-count" data-testid="finding-count">
        <strong>
          {finding.numerator} of {finding.denominator}
        </strong>{' '}
        snaps{finding.percent !== null ? ` (${finding.percent}%)` : ' (no percentage: nothing to count)'} · sample {finding.sampleSize}
        {finding.kind === 'uncertain' ? ' · too small to call' : ''}
      </p>
      {excluded.length ? (
        <p className="small muted" data-testid="finding-excluded">
          Left out ({excluded.length}): {excluded.map(([id, why]) => `${segmentName(id)} (${why})`).join('; ')}.
        </p>
      ) : null}
      <EvidenceList label="Evidence" items={finding.supportingEvidence} href={href} emptyText="No supporting play on file" />
      <EvidenceList label="Against" items={finding.contraryEvidence} href={href} />
      <p className="small muted">
        Computed {formatDate(finding.computedAt)} from {finding.gameIds.length} game{finding.gameIds.length === 1 ? '' : 's'} of film · {finding.computeVersion}
      </p>
    </article>
  );
}

/**
 * Opponent Scouting (CONTRACTS §14.6): findings are computed on the server from stored
 * segments and labels of opponent film; the page only chooses the opponent, the unit and the
 * review basis, and can freeze the current report as a snapshot.
 */
export function ScoutingPage() {
  const api = useApi();
  const ws = useWorkspace();
  const id = useId();
  const opponentId = ws.opponent?.id ?? null;
  const units: Unit[] = ['offense', 'defense', 'special_teams'];
  const [reviewBasis, setReviewBasis] = useState<ReviewBasis>('reviewed_only');
  const [title, setTitle] = useState('');

  const report = useResource(async () => {
    if (!ws.team || !opponentId) return null;
    return api.scouting.report(ws.team.id, opponentId, { unit: ws.unit, reviewBasis });
  }, [api, ws.team?.id, opponentId, ws.unit, reviewBasis]);
  const snapshots = useResource(async () => (ws.team && opponentId ? api.scouting.snapshots(ws.team.id, opponentId) : []), [api, ws.team?.id, opponentId]);

  const save = useAction(async () => {
    if (!ws.team || !opponentId) throw new Error('Choose an opponent first.');
    const snapshot = await api.scouting.saveSnapshot(ws.team.id, opponentId, { title: title.trim() || `${ws.opponent?.shortName} ${UNIT_LABELS[ws.unit].toLowerCase()} — ${formatDate(new Date().toISOString())}`, unit: ws.unit, reviewBasis });
    setTitle('');
    snapshots.reload();
    return snapshot;
  });

  const opponentOptions = ws.games.filter((g) => g.opponentId).map((g) => ({ gameId: g.id, label: `${ws.opponentName(g.opponentId)} (${ws.gameLabel(g)})` }));

  return (
    <>
      <PageHeader title="Opponent Scouting" lede="Every count states its denominator and whether unreviewed (model-proposed) labels are included. Findings are recomputed from stored labels; nothing here is typed in.">
        <div className="selector-row">
          <label htmlFor={`${id}-opp`}>
            Opponent
            <select id={`${id}-opp`} value={ws.game?.id ?? ''} onChange={(e) => ws.select({ game: e.target.value })}>
              {opponentOptions.map((o) => (
                <option key={o.gameId} value={o.gameId}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div role="group" aria-label="Opponent unit" className="unit-tabs">
            {units.map((u) => (
              <button key={u} type="button" className="chip" aria-pressed={ws.unit === u} onClick={() => ws.select({ unit: u })}>
                Their {UNIT_LABELS[u].toLowerCase()}
              </button>
            ))}
          </div>
          <fieldset className="basis-toggle">
            <legend>Review basis</legend>
            <div className="radio-row">
              <label>
                <input type="radio" name={`${id}-basis`} checked={reviewBasis === 'reviewed_only'} onChange={() => setReviewBasis('reviewed_only')} /> Reviewed labels only
              </label>
              <label>
                <input type="radio" name={`${id}-basis`} checked={reviewBasis === 'includes_inferred'} onChange={() => setReviewBasis('includes_inferred')} /> Include unreviewed (model) labels
              </label>
            </div>
          </fieldset>
        </div>
      </PageHeader>
      {!opponentId ? (
        <EmptyState title="The selected game has no opponent.">
          <p className="small">Choose a game with an opponent above.</p>
        </EmptyState>
      ) : (
        <DataState state={report} label="scouting findings">
          {(r) => {
            if (!r) return <EmptyState title="Choose an opponent." />;
            const firm = r.findings.filter((f) => f.kind !== 'uncertain');
            const uncertain = r.findings.filter((f) => f.kind === 'uncertain');
            return (
              <>
                <section className="card tight report-meta" aria-labelledby="report-meta-heading">
                  <h2 id="report-meta-heading">What this report is built from</h2>
                  <p className="small" data-testid="report-meta">
                    Sample {r.sampleSize} snaps · {reviewBasis === 'reviewed_only' ? 'reviewed labels only' : 'includes unreviewed model labels'} · computed {formatDateTime(r.computedAt, ws.team?.timezone)} · {r.computeVersion}
                  </p>
                  {r.games.length === 0 ? (
                    <p className="small muted">No opponent film is attached to this opponent's games yet; counts come from stored labels only.</p>
                  ) : (
                    <ul className="small included-games">
                      {r.games.map((g) => (
                        <li key={g.gameId}>
                          {ws.gameLabel(ws.games.find((x) => x.id === g.gameId) ?? null)}:{' '}
                          {g.assetIds.length === 0
                            ? 'no processed opponent film'
                            : g.assetIds.map((a, i) => (
                                <span key={a}>
                                  {i > 0 ? ', ' : ''}
                                  <Link to={ws.href(`/app/film/${a}`)}>film {i + 1}</Link>
                                </span>
                              ))}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="snapshot-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void save.run();
                    }}
                  >
                    <label htmlFor={`${id}-title`} className="small">
                      Snapshot title
                    </label>
                    <div className="add-item">
                      <input id={`${id}-title`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tuesday install" />
                      <button type="submit" disabled={save.status === 'saving' || r.findings.length === 0}>
                        Save snapshot
                      </button>
                    </div>
                    <SaveStatus status={save.status} error={save.error} savedText="Snapshot saved" />
                  </form>
                </section>
                {r.findings.length === 0 ? (
                  <EmptyState title={`No findings yet for ${ws.opponent?.shortName} ${UNIT_LABELS[ws.unit].toLowerCase()} on this basis.`}>
                    <p className="small">Findings appear once opponent film for this unit has proposed plays with {reviewBasis === 'reviewed_only' ? 'reviewed' : 'any'} labels.</p>
                  </EmptyState>
                ) : (
                  <>
                    <section aria-labelledby="firm-heading">
                      <h2 id="firm-heading">
                        {ws.opponent?.shortName} {UNIT_LABELS[ws.unit].toLowerCase()}: {firm.length} finding{firm.length === 1 ? '' : 's'}
                      </h2>
                      <div className="finding-grid">
                        {firm.map((f) => (
                          <FindingCard key={f.id} finding={f} href={ws.href} />
                        ))}
                      </div>
                    </section>
                    <section aria-labelledby="uncertain-heading" className="uncertain-section">
                      <h2 id="uncertain-heading">Uncertain ({uncertain.length})</h2>
                      <p className="small muted">Samples too small, or film that hid what was needed. Listed so nobody plans around them by accident.</p>
                      {uncertain.length === 0 ? (
                        <EmptyState title="Nothing uncertain for this unit." />
                      ) : (
                        <div className="finding-grid">
                          {uncertain.map((f) => (
                            <FindingCard key={f.id} finding={f} href={ws.href} />
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </>
            );
          }}
        </DataState>
      )}
      {opponentId ? (
        <section className="card" aria-labelledby="snapshots-heading">
          <h2 id="snapshots-heading">Saved snapshots</h2>
          <DataState state={snapshots} label="snapshots">
            {(items) =>
              items.length === 0 ? (
                <EmptyState title="No snapshots for this opponent yet." />
              ) : (
                <ul className="snapshot-list">
                  {items.map((s) => (
                    <li key={s.id}>
                      <strong>{s.title}</strong>{' '}
                      <span className="small muted">
                        · {s.findings.length} finding{s.findings.length === 1 ? '' : 's'} · saved {formatDateTime(s.generatedAt, ws.team?.timezone)} · inputs {s.inputsHash.slice(0, 18)}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            }
          </DataState>
        </section>
      ) : null}
    </>
  );
}
