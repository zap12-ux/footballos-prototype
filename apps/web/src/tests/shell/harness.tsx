import { render } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { ApiProvider } from '../../api/hooks';
import { createFakeApi } from '../fakeApi';
import { AuthProvider } from '../../auth/AuthContext';
import { createTestRouter } from '../../app/router';
import { workspaceStore } from '../../workspace/store';
import { draftStore } from '../../workspace/drafts';

/** Render the whole product shell at `path` against a fresh, zero-latency in-memory fake API. */
export function renderApp(path: string, options: { signedInAs?: string } = {}) {
  workspaceStore.reset();
  draftStore.reset();
  const api = createFakeApi({ latencyMs: 0, signedInAs: options.signedInAs });
  const router = createTestRouter(path);
  const utils = render(
    <ApiProvider api={api}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ApiProvider>,
  );
  return { ...utils, api, router };
}

/** jsdom has no media playback; the montage only needs play/pause to exist. */
export function stubMediaPlayback() {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  return { play, pause };
}

/** Install a `matchMedia` that answers `matches` for every query (jsdom has none). */
export function stubMatchMedia(matches: boolean) {
  const original = window.matchMedia;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  return () => {
    if (original) Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original });
    else delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  };
}
