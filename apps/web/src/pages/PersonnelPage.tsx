import { useApi, useResource } from '../api/hooks';
import { UNIT_LABELS, type Player, type Unit } from '../api/contracts';
import { DataState, EmptyState, PageHeader, StatusBadge } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

export function PersonnelPage() {
  const api = useApi();
  const ws = useWorkspace();
  const units: Unit[] = ['offense', 'defense', 'special_teams'];
  const teamId = ws.team?.id ?? null;
  const seasonId = ws.season?.id ?? null;

  const data = useResource(async () => {
    if (!teamId || !seasonId) return null;
    const [players, depthChart, packages] = await Promise.all([
      api.personnel.players(teamId, seasonId),
      api.personnel.depthChart(teamId, seasonId, ws.unit),
      api.personnel.packages(teamId, seasonId, ws.unit),
    ]);
    return { players, depthChart, packages };
  }, [api, teamId, seasonId, ws.unit]);

  const name = (players: Player[], id: string) => {
    const p = players.find((x) => x.id === id);
    return p ? `${p.jersey ? `#${p.jersey} ` : ''}${p.firstName} ${p.lastName}` : 'Unknown player';
  };

  return (
    <>
      <PageHeader title="Personnel" lede={`${ws.season?.label ?? ''} roster, the ${UNIT_LABELS[ws.unit].toLowerCase()} depth chart and personnel packages. Roster edits are approved by the head coach or the unit coordinator.`}>
        <div role="tablist" aria-label="Unit" className="unit-tabs">
          {units.map((u) => (
            <button key={u} type="button" role="tab" aria-selected={ws.unit === u} className="chip" onClick={() => ws.select({ unit: u })}>
              {UNIT_LABELS[u]}
            </button>
          ))}
        </div>
      </PageHeader>
      <DataState state={data} label="personnel">
        {(d) => {
          if (!d) return <EmptyState title="Pick a team and season." />;
          const positions = d.depthChart ? [...new Set(d.depthChart.slots.map((s) => s.position))] : [];
          const unavailable = d.players.filter((p) => p.status !== 'active');
          return (
            <div className="personnel-layout">
              <section className="card" aria-labelledby="depth-heading">
                <h2 id="depth-heading">{UNIT_LABELS[ws.unit]} depth chart</h2>
                {!d.depthChart ? (
                  <EmptyState title="No depth chart for this unit yet." />
                ) : (
                  <div className="table-scroll">
                    <table className="depth-table">
                      <thead>
                        <tr>
                          <th scope="col">Position</th>
                          <th scope="col">1st</th>
                          <th scope="col">2nd</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((pos) => {
                          const slots = d.depthChart!.slots.filter((s) => s.position === pos).sort((a, b) => a.order - b.order);
                          const cell = (order: number) => {
                            const slot = slots.find((s) => s.order === order);
                            if (!slot) return <td key={order}>—</td>;
                            const p = d.players.find((x) => x.id === slot.playerId);
                            return (
                              <td key={order}>
                                {name(d.players, slot.playerId)} {p && p.status !== 'active' ? <StatusBadge value={p.status} /> : null}
                              </td>
                            );
                          };
                          return (
                            <tr key={pos}>
                              <th scope="row">{pos}</th>
                              {cell(1)}
                              {cell(2)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {unavailable.length ? (
                  <p className="small">
                    Not available: {unavailable.map((p) => `${name(d.players, p.id)} (${p.status}${p.notes ? `: ${p.notes}` : ''})`).join('; ')}.
                  </p>
                ) : null}
              </section>

              <section className="card" aria-labelledby="packages-heading">
                <h2 id="packages-heading">Packages</h2>
                {d.packages.length === 0 ? (
                  <EmptyState title={`No ${UNIT_LABELS[ws.unit].toLowerCase()} packages defined.`} />
                ) : (
                  <ul className="package-list">
                    {d.packages.map((pkg) => {
                      const missing = pkg.playerIds.map((id) => d.players.find((p) => p.id === id)).filter((p) => p && p.status !== 'active') as Player[];
                      return (
                        <li key={pkg.id}>
                          <h3>{pkg.name}</h3>
                          <p className="small muted">{pkg.description}</p>
                          <p className="small">{pkg.playerIds.map((id) => name(d.players, id)).join(', ')}</p>
                          {missing.length ? (
                            <p className="small field-error">
                              {missing.length} player{missing.length === 1 ? '' : 's'} in this package not available: {missing.map((p) => `${p.firstName} ${p.lastName}`).join(', ')}.
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="card roster" aria-labelledby="roster-heading">
                <h2 id="roster-heading">Roster ({d.players.length})</h2>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">Name</th>
                        <th scope="col">Positions</th>
                        <th scope="col">Class</th>
                        <th scope="col">Status</th>
                        <th scope="col">Strengths</th>
                        <th scope="col">Development</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...d.players].sort((a, b) => Number(a.jersey ?? 999) - Number(b.jersey ?? 999)).map((p) => (
                        <tr key={p.id}>
                          <td className="mono">{p.jersey ?? '—'}</td>
                          <td>
                            {p.firstName} {p.lastName}
                          </td>
                          <td>{p.positions.join(', ')}</td>
                          <td>{p.classYear}</td>
                          <td>
                            <StatusBadge value={p.status} />
                          </td>
                          <td className="small">{p.strengths.join(', ') || '—'}</td>
                          <td className="small">{p.developmentPriorities.join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted">Roster import (CSV) and inline editing follow the same preview-then-apply pattern as the schedule; wired in the next milestone.</p>
              </section>
            </div>
          );
        }}
      </DataState>
    </>
  );
}
