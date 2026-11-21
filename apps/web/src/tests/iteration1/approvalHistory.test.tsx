import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../shell/harness';
import { ApiError } from '../../api';

/**
 * Iteration 1, mechanism 3 (D-014): every plan version keeps its approver, time, override flag
 * and override reason after it is superseded (HC-03), and a unit has at most one draft (HC-07).
 * Sequences follow the round-1 head-coach findings' `observed` text.
 */

const HEAD = 'user-head';
const PLANS = '/app/plans?unit=offense&game=game-w10';

describe('mechanism 3 · approval history and one draft per unit', () => {
  it('HC-03: an override needs a reason, and the superseded version still shows its original approver, time and what superseded it', async () => {
    const user = userEvent.setup();
    const { api } = renderApp(PLANS, { signedInAs: HEAD });
    await screen.findByRole('combobox', { name: /Version/ });
    const select = () => screen.getByRole('combobox', { name: /Version/ });

    // v1 is approved by the offensive coordinator; its history is visible before anything happens.
    await user.selectOptions(select(), 'pv-off-1');
    await waitFor(() => expect(screen.getByTestId('approval-history')).toHaveTextContent(/Approved .* by Marcus Ellery/));
    expect(screen.getByTestId('approval-history')).not.toHaveTextContent(/override/);

    // Back to the draft v2: the head coach approves it. The approval is an override and will not commit without a reason.
    await user.selectOptions(select(), 'pv-off-2');
    await user.click(screen.getByRole('button', { name: /^Approve v2 \(override\)$/ }));
    const form = await screen.findByTestId('override-form');
    expect(within(form).getByRole('button', { name: /Confirm override approval/ })).toBeDisabled();
    await user.type(within(form).getByLabelText(/Reason for the override/), 'Protection check against the fifth rusher must be installed Monday; coordinator travelling.');
    await user.click(within(form).getByRole('button', { name: /Confirm override approval/ }));
    await waitFor(() => expect(screen.getByText('Approved', { selector: '.badge, [class*="badge"]' })).toBeInTheDocument());
    const v2 = (await api.plans.get('game-w10', 'offense')).versions.find((v) => v.id === 'pv-off-2')!;
    expect(v2).toMatchObject({ status: 'approved', override: true, approvedBy: HEAD, overrideReason: 'Protection check against the fifth rusher must be installed Monday; coordinator travelling.' });
    expect(screen.getByTestId('approval-history')).toHaveTextContent(/Approved .* by Dana Whitlock · head-coach override: “Protection check against the fifth rusher/);

    // Reopen the superseded v1: its original actor and time are still there, with who superseded it and why.
    await user.selectOptions(select(), 'pv-off-1');
    const history = await screen.findByTestId('approval-history');
    expect(history).toHaveTextContent(/^Approved .* by Marcus Ellery · Superseded .* by v2 \(approved by Dana Whitlock, head-coach override\)$/);
    expect(screen.getByText('Superseded', { selector: '[class*="badge"]' })).toBeInTheDocument();
    const v1 = (await api.plans.get('game-w10', 'offense')).versions.find((v) => v.id === 'pv-off-1')!;
    expect(v1).toMatchObject({ status: 'superseded', approvedBy: 'user-oc', approvedAt: '2026-10-22T21:10:00.000Z', override: false, overrideReason: null, supersededByVersionId: 'pv-off-2' });
    expect(v1.supersededAt).toBeTruthy();
  });

  it('HC-03: the mock refuses a head-coach approval without a reason', async () => {
    const { api } = renderApp(PLANS, { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Weekly Game Plans$/ });
    await expect(api.plans.approve('pv-off-2', {})).rejects.toMatchObject({ status: 400, details: { reason: 'override_reason_required' } });
    expect((await api.plans.get('game-w10', 'offense')).versions.find((v) => v.id === 'pv-off-2')!.status).toBe('draft');
  });

  it('HC-07: Start a new draft while v2 is already a draft opens v2 and says so; no third version appears', async () => {
    const user = userEvent.setup();
    const { api } = renderApp(PLANS, { signedInAs: HEAD });
    await screen.findByRole('combobox', { name: /Version/ });
    const select = () => screen.getByRole('combobox', { name: /Version/ });
    expect(within(select()).getAllByRole('option')).toHaveLength(2);

    await user.selectOptions(select(), 'pv-off-1');
    await user.click(await screen.findByRole('button', { name: /Start a new draft from v1/ }));
    expect(await screen.findByTestId('draft-routed')).toHaveTextContent(/v2 is already this unit's open draft; opened it instead of creating another/);
    await waitFor(() => expect(select()).toHaveValue('pv-off-2'));
    expect(within(select()).getAllByRole('option')).toHaveLength(2);
    expect((await api.plans.get('game-w10', 'offense')).versions.map((v) => v.status)).toEqual(['approved', 'draft']);

    // The mock itself enforces the rule for any client.
    await expect(api.plans.createDraft('pv-off-1')).rejects.toBeInstanceOf(ApiError);
    await expect(api.plans.createDraft('pv-off-1')).rejects.toMatchObject({ status: 409, details: { reason: 'draft_exists', versionId: 'pv-off-2' } });
  });
});
