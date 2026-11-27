import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import { PublicLayout } from './PublicLayout';
import { WorkspaceLayout } from './WorkspaceLayout';
import { RequireAuth } from './RequireAuth';
import { NotFound } from './NotFound';
import { LandingPage } from '../pages/LandingPage';
import { SignInPage } from '../pages/SignInPage';
import { DashboardPage } from '../pages/DashboardPage';
import { SchedulePage } from '../pages/SchedulePage';
import { FilmPage } from '../pages/FilmPage';
import { AssetPage } from '../pages/AssetPage';
import { ScoutingPage } from '../pages/ScoutingPage';
import { PlansPage } from '../pages/PlansPage';
import { PlaybookPage } from '../pages/PlaybookPage';
import { PersonnelPage } from '../pages/PersonnelPage';
import { StaffPage } from '../pages/StaffPage';
import { SettingsPage } from '../pages/SettingsPage';

/**
 * Global routing (owned by Frontend, DECISIONS D-006). Paths, not hashes: refresh-safe,
 * Back/Forward work, and the static build ships `404.html` = `index.html` so a host without
 * rewrites still serves the app for any deep link. `basename` comes from Vite's `BASE_URL`.
 */
export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/sign-in', element: <SignInPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/app',
        element: <WorkspaceLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'schedule', element: <SchedulePage /> },
          { path: 'film', element: <FilmPage /> },
          { path: 'film/:assetId', element: <AssetPage /> },
          { path: 'scouting', element: <ScoutingPage /> },
          { path: 'plans', element: <PlansPage /> },
          { path: 'playbook', element: <PlaybookPage /> },
          { path: 'personnel', element: <PersonnelPage /> },
          { path: 'staff', element: <StaffPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
];

/** `BASE_URL` is `/` in dev and the `VITE_BASE_PATH` prefix when the app is mounted under a larger site. */
export function basenameFrom(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

export function createAppRouter() {
  return createBrowserRouter(routes, { basename: basenameFrom(import.meta.env.BASE_URL) });
}

/** Tests: the same routes in memory, starting at `initialPath`. */
export function createTestRouter(initialPath: string) {
  return createMemoryRouter(routes, { initialEntries: [initialPath] });
}
