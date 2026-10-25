import { useId, useState } from 'react';
import { useApi, useAction, useResource } from '../api/hooks';
import { ROLE_LABELS, UNIT_LABELS, type Role, type Unit } from '../api/contracts';
import { useMe } from '../auth/AuthContext';
import { DataState, EmptyState, PageHeader, SaveStatus, formatDate } from '../components/shell/ui';
import { useWorkspace } from '../workspace/WorkspaceContext';

const ROLES: Role[] = ['head_coach', 'coordinator', 'position_coach', 'analyst', 'viewer'];
const UNITS: Unit[] = ['offense', 'defense', 'special_teams'];

export function StaffPage() {
  const api = useApi();
  const ws = useWorkspace();
  const me = useMe();
  const id = useId();
  const teamId = ws.team?.id ?? null;
  const staff = useResource(async () => (teamId ? api.teams.staff(teamId) : null), [api, teamId]);
  const isHead = me.memberships.some((m) => m.teamId === teamId && m.role === 'head_coach');

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('position_coach');
  const [unit, setUnit] = useState<Unit | ''>('offense');
  const invite = useAction(async () => {
    if (!teamId) throw new Error('No team selected.');
    const created = await api.teams.invite(teamId, { email: email.trim(), role, unit: unit || null });
    setEmail('');
    staff.reload();
    return created;
  });
  const toggleActive = useAction(async (membershipId: string, active: boolean) => {
    if (!teamId) throw new Error('No team selected.');
    const updated = await api.teams.updateMembership(teamId, membershipId, { active });
    staff.reload();
    return updated;
  });

  return (
    <>
      <PageHeader title="Staff" lede="Who is on the staff, what each person can do, and open invitations. Only the head coach manages membership; every change is written to the audit log." />
      <DataState state={staff} label="staff">
        {(d) =>
          !d ? (
            <EmptyState title="No team selected." />
          ) : (
            <div className="staff-layout">
              <section className="card" aria-labelledby="members-heading">
                <h2 id="members-heading">Members ({d.members.length})</h2>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Role</th>
                        <th scope="col">Units</th>
                        <th scope="col">MFA</th>
                        <th scope="col">Status</th>
                        {isHead ? (
                          <th scope="col">
                            <span className="sr-only">Actions</span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {d.members.map((m) => (
                        <tr key={m.id}>
                          <td>
                            {m.user.displayName}
                            <span className="small muted block">{m.title}</span>
                            <span className="small muted block">{m.user.email}</span>
                          </td>
                          <td>{ROLE_LABELS[m.role]}</td>
                          <td>{m.units.map((u) => UNIT_LABELS[u]).join(', ')}</td>
                          <td>{m.user.mfaEnabled ? 'On' : m.role === 'head_coach' || m.role === 'coordinator' ? 'Required, not set up' : 'Off'}</td>
                          <td>{m.active ? 'Active' : 'Deactivated'}</td>
                          {isHead ? (
                            <td>
                              {m.userId !== me.user.id ? (
                                <button type="button" className="link" onClick={() => void toggleActive.run(m.id, !m.active)}>
                                  {m.active ? 'Deactivate' : 'Reactivate'}
                                </button>
                              ) : (
                                <span className="small muted">You</span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <SaveStatus status={toggleActive.status} error={toggleActive.error} />
              </section>

              <section className="card" aria-labelledby="invites-heading">
                <h2 id="invites-heading">Open invitations ({d.invites.length})</h2>
                {d.invites.length === 0 ? (
                  <p className="small muted">No invitations are waiting.</p>
                ) : (
                  <ul className="invite-list">
                    {d.invites.map((i) => (
                      <li key={i.id}>
                        <strong>{i.email}</strong> · {ROLE_LABELS[i.role]}
                        {i.unit ? ` · ${UNIT_LABELS[i.unit]}` : ''} · expires {formatDate(i.expiresAt)}
                      </li>
                    ))}
                  </ul>
                )}
                {isHead ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void invite.run();
                    }}
                    aria-labelledby={`${id}-invite-h`}
                  >
                    <h3 id={`${id}-invite-h`}>Invite a staff member</h3>
                    <div className="field-grid">
                      <label htmlFor={`${id}-email`}>
                        Email
                        <input id={`${id}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                      </label>
                      <label htmlFor={`${id}-role`}>
                        Role
                        <select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label htmlFor={`${id}-unit`}>
                        Unit
                        <select id={`${id}-unit`} value={unit} onChange={(e) => setUnit(e.target.value as Unit | '')}>
                          <option value="">All units</option>
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {UNIT_LABELS[u]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="btn-row">
                      <button type="submit" className="primary" disabled={invite.status === 'saving'}>
                        Send invitation
                      </button>
                      <SaveStatus status={invite.status} error={invite.error} savedText="Invitation created" />
                    </div>
                    <p className="small muted">Invitations expire after 7 days. Coordinators and the head coach must set up multi-factor sign-in on first use.</p>
                  </form>
                ) : (
                  <p className="small muted">Only the head coach can invite staff.</p>
                )}
              </section>
            </div>
          )
        }
      </DataState>
    </>
  );
}
