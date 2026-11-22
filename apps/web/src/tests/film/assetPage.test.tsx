import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, stubMediaPlayback } from '../shell/harness';

const HEAD = 'user-head';
const ASSET = '/app/film/asset-westmoor-1?game=game-w10';

/**
 * jsdom has no media clock: pretend the element reached `sec` and fired `timeupdate`. In mock
 * mode the stand-in clip is anchored to the selected play, so `sec` is seconds into that play.
 */
function movePlayheadTo(sec: number) {
  const video = document.querySelector('video') as HTMLVideoElement;
  Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: sec });
  fireEvent.timeUpdate(video);
}

describe('asset view: timeline, split/merge, labels, provenance, inference', () => {
  let media: ReturnType<typeof stubMediaPlayback>;
  beforeEach(() => {
    media = stubMediaPlayback();
  });
  afterEach(() => {
    media.play.mockRestore();
    media.pause.mockRestore();
  });

  it('opens with proposed cuts preselected for review and steps through them with the keyboard', async () => {
    const user = userEvent.setup();
    renderApp(ASSET, { signedInAs: HEAD });
    await screen.findByTestId('segment-counts');
    await waitFor(() => expect(screen.getByTestId('segment-counts')).toHaveTextContent(/16 proposed · 31 accepted · 1 rejected · 16 in the review queue/));
    const list = screen.getByRole('listbox', { name: /Plays on this film/ });
    // The first proposed cut (play 32) is active, not play 1.
    const active = () => within(list).getByRole('option', { selected: true });
    expect(active()).toHaveTextContent(/#32/);
    expect(active()).toHaveTextContent(/in review queue/);
    list.focus();
    await user.keyboard('{ArrowDown}');
    expect(active()).toHaveTextContent(/#33/);
    await user.keyboard('{Home}');
    expect(active()).toHaveTextContent(/#1/);
    await user.keyboard('n');
    expect(active()).toHaveTextContent(/#32/);
    // Accept with the keyboard: the cut is recorded and the queue moves on.
    await user.keyboard('a');
    await waitFor(() => expect(screen.getByTestId('segment-counts')).toHaveTextContent(/15 proposed · 32 accepted · 1 rejected · 15 in the review queue/));
    expect(active()).toHaveTextContent(/#33/);
  });

  it('splits at the playhead and merges adjacent cuts; a stale version is reported as changed elsewhere', async () => {
    const user = userEvent.setup();
    const { api } = renderApp(ASSET, { signedInAs: HEAD });
    await screen.findByTestId('segment-counts');
    // The list remounts while data reloads, so always query it afresh.
    const list = () => screen.getByRole('listbox', { name: /Plays on this film/ });
    const options = () => within(list()).getAllByRole('option');
    list().focus();
    await user.keyboard('{Home}');
    // Split needs the playhead inside play 1 (2:00–2:07): outside it, the page says so.
    await user.click(screen.getByRole('button', { name: /Split at playhead/ }));
    expect(await screen.findByText(/Move the playhead inside play 1/)).toBeInTheDocument();
    movePlayheadTo(3.5); // play 1 starts at 2:00 → playhead 2:03.5
    await user.click(screen.getByRole('button', { name: /Split at playhead/ }));
    await waitFor(() => expect(screen.getByTestId('action-notice')).toHaveTextContent(/Play 1 split at 2:03 into two cuts/));
    await waitFor(() => expect(options()).toHaveLength(49));
    expect(options()[0]).toHaveTextContent(/2:00–2:03/);
    expect(options()[1]).toHaveTextContent(/2:03–2:07/);
    expect(options()[0]).toHaveTextContent(/Coach split/);

    // Merge the two halves back together.
    await user.click(options()[0]);
    await user.click(screen.getByRole('button', { name: /Merge with next/ }));
    await waitFor(() => expect(options()).toHaveLength(48));
    expect(options()[0]).toHaveTextContent(/2:00–2:07/);
    expect(options()[0]).toHaveTextContent(/Coach merged/);

    // Someone else changes play 2 behind this page's back: the next action must not overwrite it.
    const segments = await api.media.segments('asset-westmoor-1');
    const second = segments[1];
    expect(second.reviewStatus).toBe('accepted');
    await api.media.updateSegment(second.id, { reviewStatus: 'proposed', expectedVersion: second.version });
    await user.click(options()[1]);
    await user.click(screen.getByRole('button', { name: /^Reject$/ }));
    const conflict = await screen.findByTestId('conflict');
    expect(conflict).toHaveTextContent(/changed elsewhere \(version mismatch\)\. Reload the timeline/);
    // Nothing was overwritten: the other coach's change is what the reload shows.
    await user.click(within(conflict).getByRole('button', { name: /Reload timeline/ }));
    await waitFor(() => expect(options()[1]).toHaveTextContent(/Proposed/));
    expect((await api.media.segments('asset-westmoor-1'))[1]).toMatchObject({ reviewStatus: 'proposed', version: 2 });
  });

  it('reviews a label: correction with reason, revision history and provenance; bulk accept follows the §14.5 rule', async () => {
    const user = userEvent.setup();
    renderApp(ASSET, { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 3, name: /^Labels \(384\)/ });
    expect(screen.getByTestId('label-filter-count')).toHaveTextContent(/384 labels across 48 plays/);

    // Open the model's formation proposal on play 5 and correct it with a reason.
    await user.click(screen.getByRole('button', { name: /^Formation for play 5: i_form, Inferred, confident/ }));
    const panel = await screen.findByRole('complementary', { name: /Formation · play 5/ });
    expect(within(panel).getByText(/Receiver count and backfield set/)).toBeInTheDocument();
    expect(within(panel).getByText(/not reviewed/)).toBeInTheDocument();
    const prov = within(panel).getByTestId('provenance');
    expect(prov).toHaveTextContent(/anthropic · claude-demo-vision/);
    expect(prov).toHaveTextContent(/6 frames at 1 fps, 1280x720/);
    expect(prov).toHaveTextContent(/\$0\.0166/);
    expect(within(prov).getAllByRole('button', { name: /\d+\.\ds/ })).toHaveLength(6);
    await user.click(within(panel).getByRole('radio', { name: /Correct to/ }));
    const value = within(panel).getByLabelText(/^Value$/);
    await user.clear(value);
    await user.type(value, 'ace');
    await user.type(within(panel).getByLabelText(/Reason/), 'Single back, no fullback');
    await user.click(within(panel).getByRole('button', { name: /Save label/ }));
    expect(await within(panel).findByText(/Label saved/)).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByText(/by you/)).toBeInTheDocument());
    await user.click(within(panel).getByRole('button', { name: /Show revision history/ }));
    const history = await within(panel).findByTestId('revision-history');
    await waitFor(() => expect(history).toHaveTextContent(/Inferred i_form → Corrected ace · “Single back, no fullback”/));
    expect(screen.getByRole('button', { name: /^Formation for play 5: ace, Corrected/ })).toBeInTheDocument();

    // Filters: abstentions only.
    await user.click(screen.getByRole('checkbox', { name: /Abstained only/ }));
    await waitFor(() => expect(screen.getByTestId('label-filter-count')).toHaveTextContent(/^(\d+) labels across 12 plays/));
    expect(screen.getByRole('button', { name: /Accept inferred labels in view \(0\)/ })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Abstained only/ }));

    // Bulk accept: the confirmation states the counts; abstentions and reviewed labels are skipped.
    await user.selectOptions(screen.getByLabelText(/^Key$/), 'play_type');
    // Play type: plays 1–4 are reviewed, play 7 is an abstention, plays 13–48 have no model output.
    const button = await screen.findByRole('button', { name: /Accept inferred labels in view \(7\)/ });
    await user.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('bulk-plan')).toHaveTextContent(/accepts 7 model-proposed values across 7 plays \(Play type\)\. Skipped in this view: 1 abstention \(no value to accept\) and 40 labels already reviewed/);
    await user.click(within(dialog).getByRole('button', { name: /^Accept 7$/ }));
    expect(await screen.findByTestId('bulk-result')).toHaveTextContent(/7 accepted, 0 skipped/);
    await waitFor(() => expect(screen.getByRole('button', { name: /Accept inferred labels in view \(0\)/ })).toBeDisabled());
    expect(screen.getByRole('button', { name: /^Play type for play 5: run, Accepted/ })).toBeInTheDocument();
    // The abstention is untouched: still no value.
    expect(screen.getByRole('button', { name: /^Play type for play 7: abstained, Inferred, abstained/ })).toBeInTheDocument();
  });

  it('runs inference and shows the truthful provider state; manual labeling stays available', async () => {
    const user = userEvent.setup();
    renderApp(ASSET, { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 2, name: /^Model labels$/ });
    expect(screen.getByTestId('job-polling')).toHaveTextContent(/not polling/);
    await user.click(screen.getByRole('button', { name: /Run inference/ }));
    expect(await screen.findByText(/Inference queued/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('job-polling')).toHaveTextContent(/Refreshing every 3 seconds/));
    const state = await screen.findByTestId('provider-state', {}, { timeout: 10_000 });
    expect(state).toHaveTextContent(/No model provider is configured/);
    expect(state).toHaveTextContent(/No label was invented/);
    await waitFor(() => expect(screen.getByTestId('job-polling')).toHaveTextContent(/not polling/), { timeout: 10_000 });
    // Nothing was fabricated: the unlabeled plays still have no model output and can be entered by hand.
    expect(screen.getByRole('button', { name: /^Unit for play 20: —, Unknown, no model output/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Unit for play 20/ }));
    const panel = await screen.findByRole('complementary', { name: /Unit · play 20/ });
    expect(within(panel).queryByRole('radio', { name: /Accept the model/ })).not.toBeInTheDocument();
    await user.type(within(panel).getByLabelText(/^Value$/), 'offense');
    await user.click(within(panel).getByRole('button', { name: /Save label/ }));
    expect(await within(panel).findByText(/Label saved/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Unit for play 20: offense, Corrected/ })).toBeInTheDocument();
  }, 30_000);

  it('opens from a scouting evidence link at the evidence time, on the nearest play', async () => {
    const user = userEvent.setup();
    const { router } = renderApp('/app/scouting?unit=offense&game=game-w10', { signedInAs: HEAD });
    await screen.findAllByTestId('finding-count');
    await user.click(screen.getByRole('link', { name: '2:01' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/film/asset-westmoor-1'));
    expect(router.state.location.search).toMatch(/t=121\.5/);
    await screen.findByTestId('segment-counts');
    const list = screen.getByRole('listbox', { name: /Plays on this film/ });
    // 121.5 s is inside play 1 (2:00–2:07): that play is selected and the stand-in clip is mapped onto it.
    expect(within(list).getByRole('option', { selected: true })).toHaveTextContent(/#1/);
    await waitFor(() => expect(media.play).toHaveBeenCalled());
    expect(screen.getByTestId('seek-notice')).toHaveTextContent(/stand-in footage for 2:01 \(play 1, 2:00–2:07\)/);
  });

  it('film page: a chunked upload runs against the mock, polling shows the chain complete, and the asset appears', async () => {
    const user = userEvent.setup();
    renderApp('/app/film?game=game-w10', { signedInAs: HEAD });
    await screen.findByRole('heading', { level: 1, name: /^Our Team Film$/ });
    const file = new File([new Uint8Array(3000)], 'fixture.mp4', { type: 'video/mp4' });
    await user.upload(screen.getByLabelText(/Video file/), file);
    await user.click(screen.getByRole('button', { name: /Start upload/ }));
    const status = await screen.findByTestId('upload-status');
    await waitFor(() => expect(status).toHaveTextContent(/Upload complete; processing has started/), { timeout: 10_000 });
    expect(within(status).getByRole('link', { name: /Open fixture.mp4/ })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: /fixture.mp4/ })).toBeInTheDocument();
    // The simulated worker advances one step per poll: validate → proxy → thumbnails → segment.
    await waitFor(() => expect(screen.getAllByTestId('job-segment').some((j) => /Succeeded/.test(j.textContent ?? ''))).toBe(true), { timeout: 30_000 });
  }, 40_000);
});
