// Breakpoint behaviour (QA defect D-2) and the queue → question scroll offset (D-3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { createApiClient } from '../lib/api';
import { DRAWER_OVERLAY_BELOW, QUEUE_COLLAPSE_BELOW } from '../hooks/useLayoutMode';
import { Q1, snapshot } from './fixtures';

/** matchMedia stub driven by a fake viewport width; supports `(max-width: Npx)` queries. */
function installViewport(initialWidth: number) {
  let width = initialWidth;
  const lists = new Set<{ query: string; listeners: Set<(e: MediaQueryListEvent) => void>; mql: MediaQueryList }>();
  const evaluate = (query: string) => {
    const m = /\(max-width:\s*(\d+)px\)/.exec(query);
    return m ? width <= Number(m[1]) : false;
  };
  const matchMedia = vi.fn((query: string): MediaQueryList => {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mql = {
      media: query,
      get matches() {
        return evaluate(query);
      },
      onchange: null,
      addEventListener: (_t: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
      removeEventListener: (_t: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
      addListener: (l: (e: MediaQueryListEvent) => void) => listeners.add(l),
      removeListener: (l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    lists.add({ query, listeners, mql });
    return mql;
  });
  Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
  return {
    resize(next: number) {
      width = next;
      act(() => {
        for (const { query, listeners } of lists) {
          const ev = { matches: evaluate(query), media: query } as MediaQueryListEvent;
          for (const l of listeners) l(ev);
        }
      });
    },
  };
}

function fakeRest() {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/runs')) return json({ runs: [snapshot().run] });
    if (url.startsWith('/api/state')) return json(snapshot());
    if (url.startsWith('/api/git/agents/')) return json({ branch: 'wt/x', ahead: 0, commits: [], changedFiles: [], mergedIntoIntegration: false });
    return json({ error: { code: 'not_found' } }, 404);
  });
}

const openStream = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

function renderApp() {
  const api = createApiClient({ fetchImpl: fakeRest() as unknown as typeof fetch });
  return render(<App api={api} />);
}

const app = () => screen.getByTestId('app');
const queueButton = () => screen.findByRole('button', { name: 'Open question from console-ui' });

describe('responsive layout (D-2)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', openStream);
    window.location.hash = '#token=FIXTURE-TOKEN';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error restore jsdom's absence of matchMedia
    delete window.matchMedia;
  });

  it('exports the breakpoints from the brief', () => {
    expect(DRAWER_OVERLAY_BELOW).toBe(1180);
    expect(QUEUE_COLLAPSE_BELOW).toBe(960);
  });

  it('1280 px: docked queue and docked drawer (no dialog semantics)', async () => {
    installViewport(1280);
    renderApp();
    await queueButton();
    expect(app()).toHaveAttribute('data-drawer-mode', 'docked');
    expect(app()).toHaveAttribute('data-queue-mode', 'docked');
    expect(screen.getByRole('complementary', { name: 'Needs your input' })).toHaveAttribute('data-mode', 'docked');
    expect(screen.queryByTestId('queue-bar')).toBeNull();
    await userEvent.setup().click(await queueButton());
    const drawer = await screen.findByRole('complementary', { name: /Details for console-ui/ });
    expect(drawer).toHaveAttribute('data-mode', 'docked');
    expect(drawer).not.toHaveAttribute('role', 'dialog');
    expect(screen.queryByTestId('drawer-backdrop')).toBeNull();
  });

  it('1024 px: drawer is an overlay dialog; Close visible; Escape closes and focus returns to the opener; Tab is trapped', async () => {
    installViewport(1024);
    renderApp();
    const user = userEvent.setup();
    const opener = await queueButton();
    expect(app()).toHaveAttribute('data-drawer-mode', 'overlay');
    expect(app()).toHaveAttribute('data-queue-mode', 'docked');
    await user.click(opener);
    const drawer = await screen.findByRole('dialog', { name: /Details for console-ui/ });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer).toHaveAttribute('data-mode', 'overlay');
    expect(drawer).toHaveClass('overlay');
    expect(screen.getByTestId('drawer-backdrop')).toBeInTheDocument();
    const close = within(drawer).getByRole('button', { name: 'Close details' });
    expect(close).toBeVisible();
    // opened from the queue: focus lands on the question's first input
    const card = within(drawer).getByTestId(`question-${Q1}`);
    expect(card.contains(document.activeElement)).toBe(true);

    // Tab trap: Shift+Tab from the first focusable wraps to the last; Tab from the last wraps to the first
    close.focus();
    await user.tab({ shift: true });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(close);
    const focusables = within(drawer).getAllByRole('button');
    const last = focusables[focusables.length - 1]!;
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('1024 px: clicking the backdrop or Close closes the overlay drawer', async () => {
    installViewport(1024);
    renderApp();
    const user = userEvent.setup();
    await user.click(await queueButton());
    await screen.findByRole('dialog');
    await user.click(screen.getByTestId('drawer-backdrop'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(await queueButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('800 px: queue collapses to a toggle; the overlay list opens a question and closes itself', async () => {
    installViewport(800);
    renderApp();
    const user = userEvent.setup();
    const toggle = await screen.findByRole('button', { name: /Show queue/ });
    expect(app()).toHaveAttribute('data-queue-mode', 'collapsed');
    expect(app()).toHaveAttribute('data-drawer-mode', 'overlay');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Open question from console-ui' })).toBeNull();
    await waitFor(() => expect(toggle).toHaveTextContent('2'));
    expect(toggle).toHaveTextContent('1 blocking');

    await user.click(toggle);
    const list = await screen.findByRole('dialog', { name: 'Needs your input' });
    expect(list).toHaveAttribute('data-mode', 'collapsed');
    expect(screen.getByRole('button', { name: /Hide queue/ })).toHaveAttribute('aria-expanded', 'true');
    expect(list.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Needs your input' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Show queue/ }));

    await user.click(screen.getByRole('button', { name: /Show queue/ }));
    await user.click(await screen.findByRole('button', { name: 'Open question from console-ui' }));
    const drawer = await screen.findByRole('dialog', { name: /Details for console-ui/ });
    expect(drawer).toHaveAttribute('data-mode', 'overlay');
    expect(screen.queryByRole('dialog', { name: 'Needs your input' })).toBeNull();
    expect(within(drawer).getByTestId(`question-${Q1}`)).toHaveClass('highlight');
  });

  it('switches modes live when the window is resized with the drawer open', async () => {
    const vp = installViewport(1280);
    renderApp();
    await userEvent.setup().click(await queueButton());
    expect(await screen.findByRole('complementary', { name: /Details for console-ui/ })).toHaveAttribute('data-mode', 'docked');
    vp.resize(1100);
    expect(app()).toHaveAttribute('data-drawer-mode', 'overlay');
    expect(app()).toHaveAttribute('data-queue-mode', 'docked');
    expect(screen.getByRole('dialog', { name: /Details for console-ui/ })).toHaveAttribute('data-mode', 'overlay');
    vp.resize(720);
    expect(app()).toHaveAttribute('data-queue-mode', 'collapsed');
    expect(screen.getByRole('button', { name: /Show queue/ })).toBeInTheDocument();
    vp.resize(1400);
    expect(app()).toHaveAttribute('data-drawer-mode', 'docked');
    expect(app()).toHaveAttribute('data-queue-mode', 'docked');
    expect(screen.getByRole('complementary', { name: /Details for console-ui/ })).toHaveAttribute('data-mode', 'docked');
  });
});

describe('queue → question scroll offset (D-3)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', openStream);
    window.location.hash = '#token=FIXTURE-TOKEN';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sets scroll-margin-top to the measured sticky header height before scrolling the card into view', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const h = this.classList.contains('drawer-head') ? 70 : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 0, height: h, toJSON: () => ({}) } as DOMRect;
    });
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    renderApp();
    await userEvent.setup().click(await queueButton());
    const card = await screen.findByTestId(`question-${Q1}`);
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.instances[0]).toBe(card);
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(card.style.scrollMarginTop).toBe('70px');
    expect(rect).toHaveBeenCalled();
  });

  it('falls back to the CSS default (72px) when the header cannot be measured', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    renderApp();
    await userEvent.setup().click(await queueButton());
    const card = await screen.findByTestId(`question-${Q1}`);
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(card.style.scrollMarginTop).toBe('72px');
  });
});
