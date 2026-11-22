import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, stubMediaPlayback } from '../shell/harness';
import * as demo from '../../api/mock/data';
import { planSeek, segmentAt } from '../../film/review';

/**
 * Iteration 1, mechanism 2: following evidence lands on the cited snap or says plainly that
 * the footage is unavailable (HC-05, OC-02, PC-01), and a finding without a supporting play
 * says so on its card (OC-06). The sequences follow the round-1 findings' `observed` text.
 */

const HEAD = 'user-head';
const OC = 'user-oc';
const OL = 'user-ol';
const ASSET = '/app/film/asset-westmoor-1?game=game-w10&unit=offense';
/** The mock grant's stand-in clips are 5.4–7.9 s long; any of them is shorter than this. */
const LONGEST_CLIP = 7.908;

describe('mechanism 2 · evidence links land on the cited snap', () => {
  it('every seeded evidence link resolves inside the stand-in clip or carries the unavailable notice', () => {
    const proxy = { standIn: true, durationSec: LONGEST_CLIP };
    const cited: { what: string; atSec: number }[] = [];
    for (const f of demo.findings) {
      f.supportingEvidence.forEach((e) => cited.push({ what: `${f.id} supporting`, atSec: e.atSec }));
      f.contraryEvidence.forEach((e) => cited.push({ what: `${f.id} contrary`, atSec: e.atSec }));
    }
    for (const l of demo.labels) l.inferred?.evidence.forEach((e) => cited.push({ what: `${l.id} looked-at`, atSec: e.atSec }));
    for (const p of demo.provenance) p.inspected.frameTimestampsSec.forEach((t) => cited.push({ what: `${p.id} frame`, atSec: t }));
    expect(cited.length).toBeGreaterThan(100);
    for (const c of cited) {
      const plan = planSeek(c.atSec, demo.segments, proxy);
      if (plan.kind === 'unavailable') {
        expect(plan.message, c.what).toMatch(/not in this proxy/);
      } else {
        expect(plan.mediaSec, c.what).toBeGreaterThanOrEqual(0);
        expect(plan.mediaSec, c.what).toBeLessThanOrEqual(LONGEST_CLIP);
      }
    }
    // The scouting cards' supporting and contrary examples all cite a seeded play: none is between plays.
    for (const f of demo.findings) for (const e of [...f.supportingEvidence, ...f.contraryEvidence]) expect(segmentAt(demo.segments, e.atSec), `${f.id} ${e.atSec}`).not.toBeNull();
    // A moment no play covers is refused, never seeked silently.
    expect(planSeek(100, demo.segments, proxy)).toMatchObject({ kind: 'unavailable', mediaSec: null });
    // A real proxy shorter than the request is refused too; one that covers it seeks straight there.
    expect(planSeek(640, demo.segments, { standIn: false, durationSec: 300 }).kind).toBe('unavailable');
    expect(planSeek(640, demo.segments, { standIn: false, durationSec: 6412.4 })).toMatchObject({ kind: 'direct', mediaSec: 640 });
  });

  it('OC-06: a tendency with no supporting example says "No supporting play on file"; a contrary example stays under Against', async () => {
    renderApp('/app/scouting?unit=defense&game=game-w10', { signedInAs: OC });
    await screen.findAllByTestId('finding-count');
    // Reviewed-only hides the includes-inferred cards; switch to see the fifth-rusher card as the coordinator did.
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Include unreviewed/ }));
    const card = (title: RegExp) => screen.getByRole('article', { name: title });
    await waitFor(() => expect(card(/fifth rusher/)).toBeInTheDocument());
    expect(within(card(/fifth rusher/)).getByTestId('no-supporting-play')).toHaveTextContent('No supporting play on file');
    expect(within(card(/rotate the safety late/)).getByTestId('no-supporting-play')).toHaveTextContent('No supporting play on file');
    const off = card(/boundary corner plays off coverage/);
    expect(within(off).getByTestId('no-supporting-play')).toHaveTextContent('No supporting play on file');
    expect(within(off).getByTestId('contrary-evidence')).toHaveTextContent(/Against: 85:33 Press at the goal line/);
    // The even-front card does have support, as a link to the play.
    const even = card(/even front/);
    expect(within(even).queryByTestId('no-supporting-play')).not.toBeInTheDocument();
    expect(within(even).getByRole('link', { name: '10:40' })).toBeInTheDocument();
  });

  describe('player', () => {
    let media: ReturnType<typeof stubMediaPlayback>;
    beforeEach(() => {
      media = stubMediaPlayback();
    });
    afterEach(() => {
      media.play.mockRestore();
      media.pause.mockRestore();
    });

    const video = () => document.querySelector('video') as HTMLVideoElement;

    it('OC-02: the 10:40 even-front link selects play 5 and the player names the moment the clip stands for', async () => {
      const user = userEvent.setup();
      const { router } = renderApp('/app/scouting?unit=defense&game=game-w10', { signedInAs: OC });
      await screen.findAllByTestId('finding-count');
      await user.click(screen.getByRole('link', { name: '10:40' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/app/film/asset-westmoor-1'));
      await screen.findByTestId('segment-counts');
      const list = screen.getByRole('listbox', { name: /Plays on this film/ });
      expect(within(list).getByRole('option', { selected: true })).toHaveTextContent(/#5/);
      const notice = await screen.findByTestId('seek-notice');
      await waitFor(() => expect(notice).toHaveTextContent(/stand-in footage for 10:40 \(play 5, 10:34–10:41\)/));
      expect(notice).toHaveTextContent(/credited clip is not this snap/);
      expect(screen.getByTestId('playhead')).toHaveTextContent(/Playhead at 10:40 · play 5 selected/);
      // The clip was seeked to the proportional position of 10:40 inside the play, not left at 0:00 or its end.
      await waitFor(() => expect(media.play).toHaveBeenCalled());
      expect(video().currentTime).toBeGreaterThan(0);
      expect(video().currentTime).toBeLessThan(LONGEST_CLIP);
    });

    it('PC-01: a label\'s "Looked at" link and "Play this cut" on cut 32 both say which play the clip stands for', async () => {
      const user = userEvent.setup();
      renderApp(ASSET, { signedInAs: OL });
      await screen.findByRole('heading', { level: 3, name: /^Labels \(384\)/ });
      // The page opens on cut 32 (first in the review queue): the caption already names it.
      await waitFor(() => expect(screen.getByTestId('seek-notice')).toHaveTextContent(/stand-in footage for 68:23 \(play 32, 68:23–68:30\)/));
      expect(screen.getByTestId('playhead')).toHaveTextContent(/Playhead at 68:23/);

      // Play type · play 5, Looked at 10:35–10:38 (handoff at frame 3).
      await user.click(screen.getByRole('button', { name: /^Play type for play 5: run, Inferred/ }));
      const panel = await screen.findByRole('complementary', { name: /Play type · play 5/ });
      await user.click(within(panel).getByRole('button', { name: /^10:35–10:38$/ }));
      expect(within(panel).getByTestId('evidence-seek-note')).toHaveTextContent(/Stand-in footage: 10:35 \(play 5, 10:34–10:41\)/);
      expect(screen.getByTestId('seek-notice')).toHaveTextContent(/stand-in footage for 10:35 \(play 5/);
      expect(screen.getByTestId('playhead')).toHaveTextContent(/Playhead at 10:35/);

      // Play this cut on cut 32: 68:23, not 0:00 of an unrelated clip.
      const list = screen.getByRole('listbox', { name: /Plays on this film/ });
      list.focus();
      await user.keyboard('{End}');
      await user.keyboard('{ArrowUp}'.repeat(16));
      expect(within(list).getByRole('option', { selected: true })).toHaveTextContent(/#32/);
      await user.click(screen.getByRole('button', { name: /^Play this cut$/ }));
      expect(screen.getByTestId('seek-notice')).toHaveTextContent(/stand-in footage for 68:23 \(play 32, 68:23–68:30\)/);
      expect(screen.getByTestId('playhead')).toHaveTextContent(/Playhead at 68:23 · play 32 selected/);
    });

    it('HC-05: a time no play covers is not seeked; the player and the control say the footage is not in this proxy', async () => {
      renderApp(`${ASSET}&t=100`, { signedInAs: HEAD });
      await screen.findByTestId('segment-counts');
      const notice = await screen.findByTestId('seek-notice');
      await waitFor(() => expect(notice).toHaveTextContent(/Not shown\. Footage for 1:40 is not in this proxy/));
      expect(notice).toHaveAttribute('role', 'alert');
      expect(screen.getByTestId('playhead')).toHaveTextContent(/Playhead at 0:00/);
      expect(media.play).not.toHaveBeenCalled();
      expect(video().currentTime).toBe(0);
    });
  });
});
