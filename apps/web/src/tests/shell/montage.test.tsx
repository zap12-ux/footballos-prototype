import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Montage } from '../../components/shell/Montage';
import { stubMatchMedia, stubMediaPlayback } from './harness';

const clips = ['/demo-film/play-1.mp4', '/demo-film/play-2.mp4'];

describe('landing montage', () => {
  let media: ReturnType<typeof stubMediaPlayback>;
  beforeEach(() => {
    media = stubMediaPlayback();
  });
  afterEach(() => {
    media.play.mockRestore();
    media.pause.mockRestore();
  });

  it('plays muted inline with a visible credit, and the control pauses and resumes it', async () => {
    const user = userEvent.setup();
    render(<Montage clips={clips} poster="/landing/montage-poster.svg" credit={<>Credit line</>} />);
    const video = screen.getByTestId('montage-video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('poster', '/landing/montage-poster.svg');
    expect(screen.getByText('Credit line')).toBeInTheDocument();

    const control = screen.getByRole('button', { name: /Pause montage/ });
    expect(control).toHaveAttribute('aria-pressed', 'true');
    await user.click(control);
    expect(media.pause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Play montage/ })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /Play montage/ }));
    expect(media.play).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Pause montage/ })).toBeInTheDocument();
  });

  it('chains the clips: when one ends the next one loads, and the sequence wraps', () => {
    render(<Montage clips={clips} poster="/p.svg" credit="c" />);
    const first = screen.getByTestId('montage-video') as HTMLVideoElement;
    expect(first.getAttribute('src')).toBe(clips[0]);
    fireEvent(first, new Event('ended'));
    expect((screen.getByTestId('montage-video') as HTMLVideoElement).getAttribute('src')).toBe(clips[1]);
    fireEvent(screen.getByTestId('montage-video'), new Event('ended'));
    expect((screen.getByTestId('montage-video') as HTMLVideoElement).getAttribute('src')).toBe(clips[0]);
  });

  it('honours prefers-reduced-motion: poster only, no autoplay, playback on request', async () => {
    const restore = stubMatchMedia(true);
    try {
      const user = userEvent.setup();
      render(<Montage clips={clips} poster="/landing/montage-poster.svg" credit="c" />);
      expect(screen.getByTestId('montage-poster')).toHaveAttribute('src', '/landing/montage-poster.svg');
      expect(screen.queryByTestId('montage-video')).not.toBeInTheDocument();
      expect(screen.getByTestId('montage-reduced-motion')).toHaveTextContent(/Reduced motion/);
      expect(media.play).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: /Play montage/ }));
      const video = screen.getByTestId('montage-video') as HTMLVideoElement;
      expect(video).not.toHaveAttribute('autoplay');
      expect(media.play).toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
