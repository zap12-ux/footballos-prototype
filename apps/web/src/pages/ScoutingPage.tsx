import { useId } from 'react';
import { useApi, useResource } from '../api/hooks';
import { UNIT_LABELS, type ScoutingFinding, type Unit } from '../api/contracts';
import { DataState, EmptyState, PageHeader, formatDate, formatSeconds, humanize } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

export function FindingCard({ finding }: { finding: ScoutingFinding }) {
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
        snaps{finding.percent !== null ? ` (${finding.percent}%)` : ''} · sample {finding.sampleSize}
        {finding.kind === 'uncertain' ? ' · too small to call' : ''}
      </p>
      {excluded.length ? (
        <p className="small muted">
          Left out: {excluded.map(([id, why]) => `${id.replace(/^seg-.*-(\d+)$/, 'play $1')} (${why})`).join('; ')}.
        </p>
      ) : null}
      {finding.supportingEvidence.length ? (
        <p className="small">
          Evidence: {finding.supportingEvidence.map((e) => `${formatSeconds(e.atSec)}${e.note ? ` ${e.note}` : ''}`).join(' · ')}
        </p>
      ) : null}
      {finding.contraryEvidence.length ? (
        <p className="small">
          Against: {finding.contraryEvidence.map((e) => `${formatSeconds(e.atSec)}${e.note ? ` ${e.note}` : ''}`).join(' · ')}
        </p>
      ) : null}
      <p className="small muted">
        Computed {formatDate(finding.computedAt)} from {finding.gameIds.length} game{finding.gameIds.length === 1 ? '' : 's'} of film · {finding.computeVersion}
      </p>
    </article>
  );
}

export function ScoutingPage() {
  const api = useApi();
  const ws = useWorkspace();
  const id = useId();
  const opponentId = ws.opponent?.id ?? null;
  const units: Unit[] = ['offense', 'defense', 'special_teams'];

  const data = useResource(async () => {
    if (!ws.team || !opponentId) return [] as ScoutingFinding[];
    return api.scouting.findings(ws.team.id, opponentId, ws.unit);
  }, [api, ws.team?.id, opponentId, ws.unit]);

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
        </div>
      </PageHeader>
      {!opponentId ? (
        <EmptyState title="The selected game has no opponent.">
          <p className="small">Choose a game with an opponent above.</p>
        </EmptyState>
      ) : (
        <DataState state={data} label="scouting findings">
          {(findings) => {
            const firm = findings.filter((f) => f.kind !== 'uncertain');
            const uncertain = findings.filter((f) => f.kind === 'uncertain');
            return findings.length === 0 ? (
              <EmptyState title={`No findings yet for ${ws.opponent?.shortName} ${UNIT_LABELS[ws.unit].toLowerCase()}.`}>
                <p className="small">Findings appear once opponent film for this unit has proposed plays with reviewed labels.</p>
              </EmptyState>
            ) : (
              <>
                <section aria-labelledby="firm-heading">
                  <h2 id="firm-heading">
                    {ws.opponent?.shortName} {UNIT_LABELS[ws.unit].toLowerCase()}: {firm.length} finding{firm.length === 1 ? '' : 's'}
                  </h2>
                  <div className="finding-grid">
                    {firm.map((f) => (
                      <FindingCard key={f.id} finding={f} />
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
                        <FindingCard key={f.id} finding={f} />
                      ))}
                    </div>
                  )}
                </section>
              </>
            );
          }}
        </DataState>
      )}
    </>
  );
}
