import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../shell/harness';
import { createMockApi, MOCK_STORE_KEY } from '../../api/mock';

/**
 * Iteration 1, mechanism 4: in mock mode, mutations persist across a browser reload for the
 * session, with a visible reset to seed (OC-01, PC-04). A "reload" here is a second MockApi
 * built against the same `localStorage`, which is what a page refresh does.
 */

const OC = 'user-oc';
const OL = 'user-ol';
const HEAD = 'user-head';
const PLANS = '/app/plans?unit=offense&game=game-w10';

function freshApi(signedInAs: string) {
  return createMockApi({ latencyMs: 0, persist: true, signedInAs });
}

describe('mechanism 4 · mock persistence across reload', () => {
  it('OC-01: an approved offensive plan, its comment and approver are still there after a reload (UI)', async () => {
    const user = userEvent.setup();
    const first = renderApp(PLANS, { signedInAs: OC, persist: true });
    const comments = () => screen.getByRole('complementary', { name: /Comments/ });
    await screen.findByRole('complementary', { name: /Comments/ });
    await user.type(within(comments()).getByLabelText(/^Comment$/), 'Westmoor Scout 02: who has the fifth rusher on third and long?');
    await user.click(within(comments()).getByRole('button', { name: /Post comment/ }));
    await within(comments()).findByText(/Westmoor Scout 02/);
    await user.click(screen.getByRole('button', { name: /^Approve v2$/ }));
    await waitFor(() => expect(screen.getByTestId('approval-history')).toHaveTextContent(/Approved .* by Marcus Ellery/));
    first.unmount();

    // A normal browser reload: a new page, a new MockApi, the same localStorage.
    renderApp(PLANS, { signedInAs: OC, persist: true });
    await screen.findByRole('complementary', { name: /Comments/ });
    const select = await screen.findByRole('combobox', { name: /Version/ });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['v1 · superseded', 'v2 · approved (current)']);
    expect(screen.getByTestId('approval-history')).toHaveTextContent(/Approved .* by Marcus Ellery/);
    expect(within(comments()).getByText(/Westmoor Scout 02/)).toBeInTheDocument();
  });

  it('PC-04: a saved film correction with its reason and a posted plan comment survive a reload', async () => {
    const before = freshApi(OL);
    const label = (await before.labels.forAsset('asset-westmoor-1')).find((l) => l.segmentId === 'seg-westmoor-1-10' && l.key === 'formation_family')!;
    expect(label.accepted.status).toBe('inferred');
    await before.labels.correct(label.id, { accepted: { value: null, status: 'unknown' }, reason: 'Far-side receivers hidden; cannot count the set.', expectedVersion: label.version });
    await before.plans.comment('pv-off-2', { sectionKey: 'formations', itemId: null, body: 'Play 10 formation held as unknown until the end-zone copy arrives.' });

    const after = freshApi(OL);
    const reloaded = (await after.labels.forAsset('asset-westmoor-1')).find((l) => l.id === label.id)!;
    expect(reloaded.accepted).toMatchObject({ status: 'unknown', value: null, byUserId: OL });
    const revisions = await after.labels.revisions(label.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ previousStatus: 'inferred', newStatus: 'unknown', reason: 'Far-side receivers hidden; cannot count the set.' });
    const bundle = await after.plans.get('game-w10', 'offense');
    expect(bundle.comments.some((c) => c.body.startsWith('Play 10 formation held as unknown'))).toBe(true);
  });

  it('stored state from an older schema or seed is discarded, never shown', async () => {
    const api = freshApi(OL);
    await api.plans.comment('pv-off-2', { sectionKey: null, itemId: null, body: 'to be invalidated' });
    const raw = JSON.parse(window.localStorage.getItem(MOCK_STORE_KEY)!);
    window.localStorage.setItem(MOCK_STORE_KEY, JSON.stringify({ ...raw, seedFingerprint: 'deadbeef' }));
    const next = freshApi(OL);
    expect((await next.plans.get('game-w10', 'offense')).comments.some((c) => c.body === 'to be invalidated')).toBe(false);
    expect(window.localStorage.getItem(MOCK_STORE_KEY)).toBeNull();
  });

  it('Reset demo data on /app/settings names what it clears and returns the seed; tests without persistence have no store', async () => {
    const user = userEvent.setup();
    const seeded = freshApi(HEAD);
    await seeded.plans.comment('pv-off-2', { sectionKey: null, itemId: null, body: 'Will be reset.' });
    expect(window.localStorage.getItem(MOCK_STORE_KEY)).not.toBeNull();

    const { api } = renderApp('/app/settings', { signedInAs: HEAD, persist: true });
    const card = await screen.findByTestId('demo-data');
    expect(card).toHaveTextContent(/kept across reloads; last saved/);
    await user.click(within(card).getByRole('button', { name: /^Reset demo data$/ }));
    const dialog = await screen.findByRole('dialog', { name: /Reset the demo workspace\?/ });
    expect(within(dialog).getByTestId('reset-clears')).toHaveTextContent(/plan versions, approvals and comments/);
    expect(within(dialog).getByTestId('reset-clears')).toHaveTextContent(/label corrections, revisions/);
    expect(within(dialog).getByTestId('reset-clears')).toHaveTextContent(/uploads and their processing jobs/);
    expect(dialog).toHaveTextContent(/unsaved drafts you have typed are kept/);
    await user.click(within(dialog).getByRole('button', { name: /^Reset to seed$/ }));
    expect(await within(card).findByText(/Demo data reset to the seed/)).toBeInTheDocument();
    expect((await api.plans.get('game-w10', 'offense')).comments.some((c) => c.body === 'Will be reset.')).toBe(false);
    expect(window.localStorage.getItem(MOCK_STORE_KEY)).toBeNull();
    // The next "reload" starts from the seed as well.
    expect((await freshApi(HEAD).plans.get('game-w10', 'offense')).comments.map((c) => c.id)).toEqual(['pc-1', 'pc-2']);

    // Non-persisting instances (the rest of the test suite) never write the store.
    const isolated = createMockApi({ latencyMs: 0, persist: false, signedInAs: HEAD });
    await isolated.plans.comment('pv-off-2', { sectionKey: null, itemId: null, body: 'memory only' });
    expect(window.localStorage.getItem(MOCK_STORE_KEY)).toBeNull();
    expect(isolated.demo?.persisted).toBe(false);
  });
});
