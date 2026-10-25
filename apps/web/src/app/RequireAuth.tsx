import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';

/** Unauthenticated visitors to `/app/*` go to sign-in and come back afterwards. */
export function RequireAuth() {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') {
    return (
      <div className="screen-center" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" /> Checking your session…
      </div>
    );
  }
  if (state.status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}
