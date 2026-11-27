import { useEffect, useId, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth, useMe } from '../auth/AuthContext';
import { DataState, EnvironmentLabel } from '../components/shell/ui';
import { UNIT_LABELS, type Unit } from '../api/contracts';
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceContext';
import { workspaceStore } from '../workspace/store';
import { describeDrafts, draftStore } from '../workspace/drafts';
import { FocusOnNavigate } from './FocusOnNavigate';

export const WORKSPACE_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/app', label: 'Dashboard', end: true },
  { to: '/app/schedule', label: 'Schedule' },
  { to: '/app/film', label: 'Our Team Film' },
  { to: '/app/scouting', label: 'Opponent Scouting' },
  { to: '/app/plans', label: 'Weekly Game Plans' },
  { to: '/app/playbook', label: 'Playbook' },
  { to: '/app/personnel', label: 'Personnel' },
  { to: '/app/staff', label: 'Staff' },
  { to: '/app/settings', label: 'Settings' },
];

export function workspaceTitle(pathname: string): string {
  const item = WORKSPACE_NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));
  return item ? `${item.label} · FootballOS` : 'FootballOS';
}

function useIsNarrow(): boolean {
  const query = '(max-width: 959px)';
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return narrow;
}

function ContextBar() {
  const ws = useWorkspace();
  const id = useId();
  const units: Unit[] = ['offense', 'defense', 'special_teams'];
  return (
    <div className="context-bar" role="group" aria-label="Workspace context">
      <label htmlFor={`${id}-team`}>
        <span>Team</span>
        <select id={`${id}-team`} value={ws.team?.id ?? ''} onChange={(e) => ws.select({ team: e.target.value || null })} disabled={ws.teams.length <= 1}>
          {ws.teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-season`}>
        <span>Season</span>
        <select id={`${id}-season`} value={ws.season?.id ?? ''} onChange={(e) => ws.select({ season: e.target.value || null })}>
          {ws.seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.isCurrent ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-game`}>
        <span>Game</span>
        <select id={`${id}-game`} value={ws.game?.id ?? ''} onChange={(e) => ws.select({ game: e.target.value || null })}>
          {ws.games.map((g) => (
            <option key={g.id} value={g.id}>
              {ws.gameLabel(g)}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`${id}-unit`}>
        <span>Unit</span>
        <select id={`${id}-unit`} value={ws.unit} onChange={(e) => ws.select({ unit: e.target.value as Unit })}>
          {units.map((u) => (
            <option key={u} value={u}>
              {UNIT_LABELS[u]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Shell() {
  const ws = useWorkspace();
  const me = useMe();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const narrow = useIsNarrow();
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();

  // Close the collapsed menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const membership = me.memberships.find((m) => m.teamId === ws.team?.id) ?? me.memberships[0];

  async function onSignOut() {
    // Sign-out is the one navigation that must drop drafts: say what goes before it does.
    const pending = describeDrafts();
    if (pending.length && !window.confirm(`Signing out discards unsaved work: ${pending.join('; ')}. Sign out anyway?`)) return;
    draftStore.reset();
    await signOut();
    workspaceStore.reset();
    navigate('/sign-in', { replace: true });
  }

  const nav = (
    <nav id={navId} className="ws-nav" aria-label="Workspace" hidden={narrow && !menuOpen}>
      <ul>
        {WORKSPACE_NAV.map((item) => (
          <li key={item.to}>
            <NavLink to={ws.href(item.to)} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="ws-nav-foot">
        <button type="button" className="link small" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className={`ws-shell${narrow ? ' narrow' : ''}`}>
      <FocusOnNavigate title={workspaceTitle(location.pathname)} />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="ws-header">
        <div className="ws-header-row">
          {narrow ? (
            <button type="button" className="menu-toggle" aria-expanded={menuOpen} aria-controls={navId} onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? 'Close menu' : 'Menu'}
            </button>
          ) : null}
          <span className="wordmark">
            Football<span>OS</span>
          </span>
          {ws.team ? <EnvironmentLabel kind={ws.team.environmentKind} detail={ws.team.environmentKind === 'demo' ? 'Fictional records for demonstration' : undefined} /> : null}
          <span className="ws-user" data-testid="signed-in-as">
            {me.user.displayName}
            {membership ? <span className="muted"> · {membership.title}</span> : null}
          </span>
        </div>
        {ws.status === 'ready' ? <ContextBar /> : null}
      </header>
      <div className="ws-body">
        {nav}
        <main id="main" tabIndex={-1} className="ws-main">
          <DataState state={{ status: ws.status, data: ws.status === 'ready' ? true : null, error: ws.error, reload: ws.reload }} label="your team">
            {() => <Outlet />}
          </DataState>
        </main>
      </div>
      <footer className="ws-footer">
        <span>{ws.team?.environmentKind === 'demo' ? 'Demo environment: every record on this screen is fictional and labeled demo.' : 'Team records are private to your staff and stay on your server.'}</span>
      </footer>
    </div>
  );
}

export function WorkspaceLayout() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
