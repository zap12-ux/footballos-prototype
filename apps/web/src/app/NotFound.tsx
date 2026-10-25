import { Link, useLocation } from 'react-router';
import { FocusOnNavigate } from './FocusOnNavigate';

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="public-shell">
      <FocusOnNavigate title="Page not found · FootballOS" />
      <main id="main" tabIndex={-1} className="public-main narrow">
        <h1>Page not found</h1>
        <p>
          There is nothing at <code>{pathname}</code>.
        </p>
        <p className="btn-row">
          <Link className="btn" to="/">
            Go to the landing page
          </Link>
          <Link className="btn" to="/app">
            Open the workspace
          </Link>
        </p>
      </main>
    </div>
  );
}
