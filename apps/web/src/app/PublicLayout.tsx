import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';

/** Shell for the landing page and sign-in: wordmark, primary action, one footer. */
export function PublicLayout() {
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
        <nav aria-label="Primary" className="public-nav">
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
      </footer>
    </div>
  );
}
