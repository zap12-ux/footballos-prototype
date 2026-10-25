import { Link, Outlet } from 'react-router';
import { useApi } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { EnvironmentLabel } from '../components/shell/ui';
import { DEMO_FILM_CREDIT } from '../data/demoFilm';

/** Shell for the landing page and sign-in: wordmark, environment label, one footer. */
export function PublicLayout() {
  const api = useApi();
  const { state } = useAuth();
  return (
    <div className="public-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="public-header">
        <Link to="/" className="wordmark" aria-label="FootballOS home">
          Football<span>OS</span>
        </Link>
        {api.mode === 'mock' ? <EnvironmentLabel kind="demo" detail="Served from fictional demo data; no server is connected." /> : null}
        <nav aria-label="Primary" className="public-nav">
          <Link to="/prototype/" state={{ demo: true }}>
            Film-review demo
          </Link>
          {state.status === 'authenticated' ? (
            <Link to="/app" className="btn primary">
              Open workspace
            </Link>
          ) : (
            <Link to="/sign-in" className="btn primary">
              Sign in
            </Link>
          )}
        </nav>
      </header>
      <Outlet />
      <footer className="public-footer">
        <p>FootballOS is a private, invite-only workspace for one coaching staff. Nothing here is a public feed.</p>
        <p className="small muted">
          Demo footage: <em>{DEMO_FILM_CREDIT.title}</em>, {DEMO_FILM_CREDIT.holder},{' '}
          <a href={DEMO_FILM_CREDIT.licenseUrl} target="_blank" rel="noreferrer">
            {DEMO_FILM_CREDIT.license}
          </a>
          ; {DEMO_FILM_CREDIT.changes}. Winchester Hawks is a fictional program.
        </p>
      </footer>
    </div>
  );
}
