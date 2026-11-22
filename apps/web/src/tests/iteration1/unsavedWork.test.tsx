import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, stubMediaPlayback } from '../shell/harness';

/**
 * Iteration 1, mechanism 1: unsaved coach input survives ordinary navigation inside the
 * workspace. Each test replays the sequence a round-1 reviewer recorded in the finding's
 * `observed` text (tools/review-agents/reports/round-1/*.json) and asserts the input is still
 * there afterwards. On the integration baseline (f48a241) each of these fails.
 */

const HEAD = 'user-head';
const OC = 'user-oc';
const OL = 'user-ol';
const PLANS = '/app/plans?unit=offense&game=game-w10';

function section(title: RegExp) {
  return screen.getByRole('region', { name: title });
}

describe('mechanism 1 · unsaved-work guard', () => {
  it('HC-01: a third objective added before Save draft is still there after switching units and back', async () => {
    const user = userEvent.setup();
    renderApp(PLANS, { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 3, name: /^Objectives \(2\)/ });

    // Add the Sunday protection objective: Objectives goes from two to three.
    await user.type(within(section(/^Objectives/)).getByLabelText(/Add to Objectives/), 'Sunday protection check against the fifth rusher.');
    await user.click(within(section(/^Objectives/)).getByRole('button', { name: /^Add$/ }));
    expect(screen.getByRole('heading', { level: 3, name: /^Objectives \(3\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save draft$/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Submit for review/ })).toBeDisabled();

    // Switch units without saving, then come back.
    await user.click(screen.getByRole('tab', { name: /^Special teams$/ }));
    await screen.findByRole('heading', { level: 3, name: /^Kickoff and kickoff return/ });
    await user.click(screen.getByRole('tab', { name: /^Offense$/ }));

    // The pending objective is back, and the page does not claim the draft is saved.
    expect(await screen.findByRole('heading', { level: 3, name: /^Objectives \(3\)/ })).toBeInTheDocument();
    expect(within(section(/^Objectives/)).getByText(/Sunday protection check/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Save draft$/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^Draft saved$/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('unsaved-indicator')).toHaveTextContent(/Unsaved changes/);

    // Saving commits it and clears the indicator.
    await user.click(screen.getByRole('button', { name: /^Save draft$/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Draft saved$/ })).toBeInTheDocument());
    expect(screen.queryByTestId('unsaved-indicator')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^Objectives \(3\)/ })).toBeInTheDocument();
  });

  it('OC-10: an item added to Protections and another still typed in the Add field both survive a trip to scouting', async () => {
    const user = userEvent.setup();
    renderApp(PLANS, { signedInAs: OC });
    await screen.findByRole('heading', { level: 3, name: /^Protections \(1\)/ });

    const add = () => within(section(/^Protections/)).getByLabelText(/Add to Protections/);
    await user.type(add(), 'Blue');
    await user.click(within(section(/^Protections/)).getByRole('button', { name: /^Add$/ }));
    expect(screen.getByRole('heading', { level: 3, name: /^Protections \(2\)/ })).toBeInTheDocument();
    await user.type(add(), 'Gold');
    expect(add()).toHaveValue('Gold');

    // Leave the draft for scouting without Save draft, then return through the workspace nav.
    await user.click(screen.getByRole('link', { name: /^Opponent Scouting$/ }));
    await screen.findByRole('heading', { level: 1, name: /^Opponent Scouting$/ });
    await user.click(screen.getByRole('link', { name: /^Weekly Game Plans$/ }));
    await screen.findByRole('heading', { level: 1, name: /^Weekly Game Plans$/ });

    // Both entries are back: Blue on the list, Gold still in the field.
    expect(await screen.findByRole('heading', { level: 3, name: /^Protections \(2\)/ })).toBeInTheDocument();
    expect(within(section(/^Protections/)).getByText('Blue')).toBeInTheDocument();
    expect(add()).toHaveValue('Gold');
    expect(screen.getByTestId('unsaved-indicator')).toHaveTextContent(/Unsaved changes · 1 Add field not added/);
    expect(screen.queryByRole('button', { name: /^Draft saved$/ })).not.toBeInTheDocument();
  });

  it('PC-05: an unposted Formations comment and its section are back after following film and returning', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(PLANS, { signedInAs: OL });
    await screen.findByRole('complementary', { name: /Comments/ });
    const comments = () => screen.getByRole('complementary', { name: /Comments/ });

    await user.selectOptions(within(comments()).getByLabelText(/^On section$/), 'formations');
    await user.type(within(comments()).getByLabelText(/^Comment$/), 'Hold the trips test; check play 10 before Monday.');
    expect(within(comments()).getByTestId('comment-draft-kept')).toBeInTheDocument();

    // Check the cited film inside the workspace, then come back through the nav.
    await router.navigate('/app/film/asset-westmoor-1?game=game-w10&unit=offense&t=1276.5');
    await screen.findByRole('heading', { level: 1, name: /^Our Team Film$/ });
    await user.click(screen.getByRole('link', { name: /^Weekly Game Plans$/ }));
    await screen.findByRole('complementary', { name: /Comments/ });

    // The section is still Formations and the text is still there, not reset to "Whole plan".
    await waitFor(() => expect(within(comments()).getByLabelText(/^Comment$/)).toHaveValue('Hold the trips test; check play 10 before Monday.'));
    expect(within(comments()).getByLabelText(/^On section$/)).toHaveValue('formations');

    // Posting clears the draft.
    await user.click(within(comments()).getByRole('button', { name: /Post comment/ }));
    expect(await within(comments()).findByText(/Hold the trips test; check play 10 before Monday\./)).toBeInTheDocument();
    await waitFor(() => expect(within(comments()).getByLabelText(/^Comment$/)).toHaveValue(''));
  });

  describe('label review', () => {
    let media: ReturnType<typeof stubMediaPlayback>;
    beforeEach(() => {
      media = stubMediaPlayback();
    });
    afterEach(() => {
      media.play.mockRestore();
      media.pause.mockRestore();
    });

    it('PC-03: a pending formation correction and its reason survive selecting another label and coming back', async () => {
      const user = userEvent.setup();
      renderApp('/app/film/asset-westmoor-1?game=game-w10&unit=offense', { signedInAs: OL });
      await screen.findByRole('heading', { level: 3, name: /^Labels \(384\)/ });

      // Formation · play 8 proposes trips_left; the coach starts a correction.
      await user.click(screen.getByRole('button', { name: /^Formation for play 8: trips_left, Inferred/ }));
      let panel = await screen.findByRole('complementary', { name: /Formation · play 8/ });
      await user.click(within(panel).getByRole('radio', { name: /Correct to/ }));
      const value = within(panel).getByLabelText(/^Value$/);
      await user.clear(value);
      await user.type(value, 'balanced two-by-two');
      await user.type(within(panel).getByLabelText(/Reason/), 'Two receivers each side, back offset weak.');
      expect(within(panel).getByTestId('pending-correction')).toBeInTheDocument();

      // Check the neighbouring motion tag, then come back to the formation cell.
      await user.click(screen.getByRole('button', { name: /^Motion for play 8/ }));
      await screen.findByRole('complementary', { name: /Motion · play 8/ });
      expect(screen.getByRole('button', { name: /^Formation for play 8: trips_left, Inferred, .*, unsaved correction$/ })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^Formation for play 8/ }));
      panel = await screen.findByRole('complementary', { name: /Formation · play 8/ });

      // Not reset to Accept / trips_left / empty reason: the work in progress is intact.
      expect(within(panel).getByRole('radio', { name: /Correct to/ })).toBeChecked();
      expect(within(panel).getByLabelText(/^Value$/)).toHaveValue('balanced two-by-two');
      expect(within(panel).getByLabelText(/Reason/)).toHaveValue('Two receivers each side, back offset weak.');

      // Saving commits it, clears the pending marker and writes the reason to the history.
      await user.click(within(panel).getByRole('button', { name: /Save label/ }));
      expect(await within(panel).findByText(/Label saved/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: /^Formation for play 8: balanced two-by-two, Corrected/ })).toBeInTheDocument());
      expect(screen.queryByTestId('pending-correction')).not.toBeInTheDocument();
    });
  });
});
