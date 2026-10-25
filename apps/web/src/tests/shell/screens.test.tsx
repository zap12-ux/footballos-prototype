import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness';
import { PLAN_SECTION_TEMPLATES } from '../../api/contracts';

const HEAD = 'user-head';

describe('workspace screens on the mock API', () => {
  it('dashboard: environment label, this week’s game, open tasks, recent film and plan statuses', async () => {
    renderApp('/app', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Dashboard$/ });
    expect(screen.getByTestId('environment-label')).toHaveTextContent('Demo environment');
    expect(await screen.findByRole('region', { name: /This week.s game/ })).toHaveTextContent(/Week 10 · at Westmoor/);
    const tasks = await screen.findByRole('region', { name: /Open tasks/ });
    expect(within(tasks).getByText(/16 proposed play cuts are waiting for review/)).toBeInTheDocument();
    expect(within(tasks).getByText(/Defense plan version 1 is waiting for approval/)).toBeInTheDocument();
    expect(within(tasks).getByText(/was rejected/)).toBeInTheDocument();
    const film = screen.getByRole('region', { name: /Recent film/ });
    expect(within(film).getByText('westmoor_vs_stonebrook_sideline.mp4')).toBeInTheDocument();
    const plans = screen.getByRole('region', { name: /Plan status/ });
    expect(within(plans).getAllByText('Draft')).toHaveLength(2); // offense v2 and special teams v1
    expect(within(plans).getByText('In review')).toBeInTheDocument();
  });

  it('scouting: every finding shows its denominator and review basis; uncertain findings are separated', async () => {
    const user = userEvent.setup();
    renderApp('/app/scouting?unit=offense&game=game-w10', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Opponent Scouting$/ });
    // Default basis: reviewed labels only; the report says so and every finding agrees.
    let counts = await screen.findAllByTestId('finding-count');
    expect(counts.map((c) => c.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/19 of 54 snaps \(35\.2%\)/)]));
    expect(screen.getAllByTestId('review-basis').map((b) => b.textContent)).toEqual(expect.arrayContaining(['Reviewed labels only']));
    expect(screen.getAllByTestId('review-basis').map((b) => b.textContent)).not.toContain('Includes unreviewed labels');
    expect(screen.getByTestId('report-meta')).toHaveTextContent(/reviewed labels only/);
    // Including unreviewed labels brings in the findings that depend on them.
    await user.click(screen.getByRole('radio', { name: /Include unreviewed/ }));
    await waitFor(() => expect(screen.getAllByTestId('review-basis').map((b) => b.textContent)).toContain('Includes unreviewed labels'));
    counts = screen.getAllByTestId('finding-count');
    expect(counts.map((c) => c.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/9 of 11 snaps/)]));
    const uncertain = screen.getByRole('region', { name: /Uncertain \(1\)/ });
    expect(within(uncertain).getByRole('heading', { level: 3, name: /may favour screens on third and long/ })).toBeInTheDocument();
    expect(within(uncertain).getByTestId('finding-count')).toHaveTextContent(/3 of 7 snaps .* too small to call/);
  });

  it('schedule: record from final games only, statuses and results, and a manual add', async () => {
    const user = userEvent.setup();
    renderApp('/app/schedule', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Schedule$/ });
    expect(screen.getByText(/^5–2$/)).toBeInTheDocument();
    expect(screen.getByText('Postponed')).toBeInTheDocument();
    expect(screen.getAllByText('Final').length).toBe(7);
    const before = screen.getAllByRole('row').length;
    await user.type(screen.getByLabelText(/^Week$/), '12');
    await user.selectOptions(screen.getByLabelText(/^Opponent$/), 'opp-linden');
    await user.click(screen.getByRole('button', { name: /^Add game$/ }));
    expect(await screen.findByText(/Game added/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('row').length).toBe(before + 1));
  });

  it('plans: unit tabs, the CONTRACTS §11 section templates, draft/approved badges and the comments panel', async () => {
    const user = userEvent.setup();
    renderApp('/app/plans?unit=offense&game=game-w10', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Weekly Game Plans$/ });
    for (const section of PLAN_SECTION_TEMPLATES.offense) {
      expect(await screen.findByRole('heading', { level: 3, name: new RegExp(`^${section.title}`) })).toBeInTheDocument();
    }
    expect(screen.getByText('Draft')).toBeInTheDocument();
    const comments = screen.getByRole('complementary', { name: /Comments/ });
    expect(within(comments).getByText(/Hold the trips test/)).toBeInTheDocument();
    await user.type(within(comments).getByLabelText(/^Comment$/), 'Agreed; revisit after Thursday film.');
    await user.click(within(comments).getByRole('button', { name: /Post comment/ }));
    expect(await within(comments).findByText(/Agreed; revisit after Thursday film/)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Special teams$/ }));
    for (const section of PLAN_SECTION_TEMPLATES.special_teams) {
      expect(await screen.findByRole('heading', { level: 3, name: new RegExp(`^${section.title}`) })).toBeInTheDocument();
    }
  });

  it('playbook: proposed versus approved concepts, and an approval records the decision', async () => {
    const user = userEvent.setup();
    renderApp('/app/playbook?unit=offense', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Playbook$/ });
    expect(await screen.findByRole('heading', { level: 3, name: /^Proposed \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^Approved \(4\)/ })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /^Approve$/ })[0]);
    expect(await screen.findByRole('heading', { level: 3, name: /^Proposed \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^Approved \(5\)/ })).toBeInTheDocument();
  });

  it('film: upload context form, processing progress, rejection reason and a segment list', async () => {
    const user = userEvent.setup();
    renderApp('/app/film?game=game-w10', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Our Team Film$/ });
    expect(await screen.findByText(/Proposing play boundaries/)).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
    expect(screen.getByText(/no video stream that ffprobe can read/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show proposed plays/ }));
    expect(await screen.findByText(/plays proposed/)).toHaveTextContent(/48 plays proposed · 31 accepted · 16 awaiting review · 1 rejected/);
    // Submitting without a file is a recoverable validation error.
    await user.click(screen.getByRole('button', { name: /Start upload/ }));
    expect(await screen.findByText(/Choose a video file first/)).toHaveAttribute('role', 'alert');
  });

  it('personnel and staff: depth chart, packages with availability, members and an invite', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/app/personnel?unit=offense', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Personnel$/ });
    expect(await screen.findByRole('heading', { level: 2, name: /Offense depth chart/ })).toBeInTheDocument();
    expect(screen.getByText(/Roster \(25\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 player in this package not available/)).toBeInTheDocument();

    await router.navigate('/app/staff');
    await screen.findByRole('heading', { level: 1, name: /^Staff$/ });
    expect(await screen.findByText(/Members \(5\)/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Email$/), 'db.coach@winchester-hawks.demo');
    await user.click(screen.getByRole('button', { name: /Send invitation/ }));
    expect(await screen.findByText(/Invitation created/)).toBeInTheDocument();
    expect(await screen.findByText(/Open invitations \(2\)/)).toBeInTheDocument();
  });

  it('settings: retention saves with a version check and surfaces a conflict honestly', async () => {
    const user = userEvent.setup();
    const { api } = renderApp('/app/settings', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Settings$/ });
    const field = await screen.findByLabelText(/Keep uploaded film for/);
    await user.clear(field);
    await user.type(field, '180');
    // Someone else saves first: the next write must report a conflict, not overwrite.
    await api.teams.updateSettings('team-winchester-demo', { retentionDays: 90, expectedVersion: 1 });
    await user.click(screen.getByRole('button', { name: /Save settings/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/version 1 expected, current is 2/);
  });
});
