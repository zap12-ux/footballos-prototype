import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness';
import { selectionQuery, workspaceStore } from '../../workspace/store';

const HEAD = 'user-head';

describe('workspace context in the URL query', () => {
  it('completes the query with the resolved team, season, game and unit', async () => {
    const { router } = renderApp('/app', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Dashboard$/ });
    await waitFor(() => {
      const q = new URLSearchParams(router.state.location.search);
      expect(q.get('team')).toBe('team-winchester-demo');
      expect(q.get('season')).toBe('season-2026');
      expect(q.get('game')).toBe('game-w10'); // this week's game, from the demo clock
      expect(q.get('unit')).toBe('offense');
    });
    expect(workspaceStore.get()).toEqual({ team: 'team-winchester-demo', season: 'season-2026', game: 'game-w10', unit: 'offense' });
  });

  it('keeps a unit chosen in the URL when navigating between pages', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/app?unit=defense', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Dashboard$/ });
    await user.click(screen.getByRole('link', { name: /^Weekly Game Plans$/ }));
    await screen.findByRole('heading', { level: 1, name: /^Weekly Game Plans$/ });
    expect(router.state.location.pathname).toBe('/app/plans');
    expect(new URLSearchParams(router.state.location.search).get('unit')).toBe('defense');
    expect(screen.getByRole('tab', { name: /^Defense$/ })).toHaveAttribute('aria-selected', 'true');
    // The defense plan is the one in review.
    expect(await screen.findByText(/^In review$/)).toBeInTheDocument();
  });

  it('changing the context bar rewrites the query and every page follows it', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/app/scouting', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Opponent Scouting$/ });
    await screen.findByText(/19 of 54/);
    await user.selectOptions(screen.getByLabelText(/^Unit$/), 'special_teams');
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('unit')).toBe('special_teams'));
    expect(await screen.findByText(/6 of 8/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^Game$/), 'game-w9');
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('game')).toBe('game-w9'));
    expect(await screen.findByText(/No findings yet for Pine Hollow/)).toBeInTheDocument();
  });

  it('serialises only the set keys', () => {
    expect(selectionQuery({ team: 't', season: null, game: null, unit: 'offense' })).toBe('?team=t&unit=offense');
    expect(selectionQuery({ team: null, season: null, game: null, unit: null })).toBe('');
  });
});
