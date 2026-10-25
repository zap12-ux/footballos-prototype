import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderApp, stubMediaPlayback } from './harness';
import { basenameFrom } from '../../app/router';

const HEAD = 'user-head';

describe('routing: every route renders from a direct URL', () => {
  let restore: ReturnType<typeof stubMediaPlayback>;
  beforeEach(() => {
    restore = stubMediaPlayback();
  });
  afterEach(() => {
    restore.play.mockRestore();
    restore.pause.mockRestore();
  });

  it('renders the public landing page at / with sign-in and demo actions', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: /Game film to game plan/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /^Sign in$/i }).length).toBeGreaterThan(0);
    const demo = screen.getByRole('link', { name: /Try the demo/i });
    expect(demo.getAttribute('href')).toBe('/prototype/#/demo');
    // Product site only: no course mention, no fabricated customers or metrics.
    expect(document.body.textContent).not.toMatch(/Georgetown|MPIM|Module 7/);
    expect(document.body.textContent).not.toMatch(/\d+\s?%/);
    expect(document.body.textContent).not.toMatch(/customers|testimonial/i);
    // The hero montage is manifest-driven; with no clips shipped it shows the poster only
    // and never references the prototype's credited demo clips.
    expect(screen.getByTestId('montage-poster')).toBeInTheDocument();
    expect(screen.queryByTestId('montage-video')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/demo-film\//);
  });

  it('renders /sign-in', async () => {
    renderApp('/sign-in');
    expect(await screen.findByRole('heading', { level: 1, name: /^Sign in$/ })).toBeInTheDocument();
  });

  const workspaceRoutes: [string, RegExp][] = [
    ['/app', /^Dashboard$/],
    ['/app/schedule', /^Schedule$/],
    ['/app/film', /^Our Team Film$/],
    ['/app/scouting', /^Opponent Scouting$/],
    ['/app/plans', /^Weekly Game Plans$/],
    ['/app/playbook', /^Playbook$/],
    ['/app/personnel', /^Personnel$/],
    ['/app/staff', /^Staff$/],
    ['/app/settings', /^Settings$/],
  ];

  for (const [path, heading] of workspaceRoutes) {
    it(`renders ${path} for a signed-in coach`, async () => {
      renderApp(path, { signedInAs: HEAD });
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
      // Every workspace screen shows the environment label from Team.environmentKind.
      expect(screen.getByTestId('environment-label')).toHaveTextContent(/Demo environment/);
      // Exactly one h1 per page and the main landmark is focusable for route changes.
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(document.getElementById('main')).toHaveAttribute('tabindex', '-1');
    });
  }

  it('mounts the Module 7 prototype unchanged under /prototype/', async () => {
    renderApp('/prototype/');
    expect(await screen.findByRole('heading', { level: 1, name: /^FootballOS$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try the demo \(about 5 minutes\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start a research session/i })).toBeInTheDocument();
    expect(screen.getByTestId('honesty-line')).toHaveTextContent(/Simulated AI/);
  });

  it('redirects the task-board alias /demo/film-review to the prototype', async () => {
    const { router } = renderApp('/demo/film-review');
    await waitFor(() => expect(router.state.location.pathname).toBe('/prototype/'));
    expect(await screen.findByRole('button', { name: /Try the demo \(about 5 minutes\)/i })).toBeInTheDocument();
  });

  it('shows a 404 page for an unknown path with ways back', async () => {
    renderApp('/nothing/here');
    expect(await screen.findByRole('heading', { level: 1, name: /Page not found/i })).toBeInTheDocument();
    expect(screen.getByText('/nothing/here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /landing page/i })).toBeInTheDocument();
  });

  it('derives the router basename from Vite BASE_URL', () => {
    expect(basenameFrom('/')).toBe('/');
    expect(basenameFrom('/footballos-prototype/')).toBe('/footballos-prototype');
  });

  it('moves focus to the main landmark when the route changes', async () => {
    const { router } = renderApp('/app', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Dashboard$/ });
    await router.navigate('/app/schedule');
    await screen.findByRole('heading', { level: 1, name: /^Schedule$/ });
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main')));
  });
});
