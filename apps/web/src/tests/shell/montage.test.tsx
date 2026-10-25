import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Montage, resolveAssetPath, type MontageManifest } from '../../components/shell/Montage';
import { stubMatchMedia, stubMediaPlayback } from './harness';

const withClips: MontageManifest = {
  poster: 'montage/poster.svg',
  clips: [
    { src: 'montage/clip-1.mp4', credit: 'Generated clip 1' },
    { src: 'montage/clip-2.mp4' },
  ],
};
const posterOnly: MontageManifest = { poster: 'montage/poster.svg', clips: [] };

describe('landing montage (manifest-driven)', () => {
  let media: ReturnType<typeof stubMediaPlayback>;
  beforeEach(() => {
    media = stubMediaPlayback();
  });
  afterEach(() => {
    media.play.mockRestore();
    media.pause.mockRestore();
  });

  it('with an empty clip list renders the poster only: no video, no control, no autoplay', () => {
    render(<Montage manifest={posterOnly} />);
    expect(screen.getByTestId('montage-poster')).toHaveAttribute('src', '/montage/poster.svg');
    expect(screen.queryByTestId('montage-video')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(media.play).not.toHaveBeenCalled();
  });

  it('with clips plays muted inline with the clip credit, and the control pauses and resumes', async () => {
    const user = userEvent.setup();
    render(<Montage manifest={withClips} />);
    const video = screen.getByTestId('montage-video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('poster', '/montage/poster.svg');
    expect(video.getAttribute('src')).toBe('/montage/clip-1.mp4');
    expect(screen.getByText('Generated clip 1')).toBeInTheDocument();

    const control = screen.getByRole('button', { name: /Pause montage/ });
    expect(control).toHaveAttribute('aria-pressed', 'true');
    await user.click(control);
    expect(media.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Play montage/ })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /Play montage/ }));
    expect(media.play).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Pause montage/ })).toBeInTheDocument();
  });

  it('chains the clips in manifest order and loops the sequence', () => {
    render(<Montage manifest={withClips} />);
    fireEvent(screen.getByTestId('montage-video'), new Event('ended'));
    expect(screen.getByTestId('montage-video').getAttribute('src')).toBe('/montage/clip-2.mp4');
    expect(screen.queryByText('Generated clip 1')).not.toBeInTheDocument();
    fireEvent(screen.getByTestId('montage-video'), new Event('ended'));
    expect(screen.getByTestId('montage-video').getAttribute('src')).toBe('/montage/clip-1.mp4');
  });

  it('honours prefers-reduced-motion: poster only, no autoplay, playback on request', async () => {
    const restore = stubMatchMedia(true);
    try {
      const user = userEvent.setup();
      render(<Montage manifest={withClips} />);
      expect(screen.getByTestId('montage-poster')).toBeInTheDocument();
      expect(screen.queryByTestId('montage-video')).not.toBeInTheDocument();
      expect(screen.getByTestId('montage-reduced-motion')).toHaveTextContent(/Reduced motion/);
      expect(media.play).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: /Play montage/ }));
      expect(screen.getByTestId('montage-video')).not.toHaveAttribute('autoplay');
      expect(media.play).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('resolves manifest paths against BASE_URL and leaves absolute URLs alone', () => {
    expect(resolveAssetPath('montage/poster.svg', '/footballos-prototype/')).toBe('/footballos-prototype/montage/poster.svg');
    expect(resolveAssetPath('/already/absolute.mp4', '/base/')).toBe('/already/absolute.mp4');
    expect(resolveAssetPath('https://cdn.example/clip.mp4', '/base/')).toBe('https://cdn.example/clip.mp4');
  });
});
