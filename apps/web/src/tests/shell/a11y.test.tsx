import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import axe from 'axe-core';
import { renderApp, stubMediaPlayback } from './harness';

/**
 * axe-core on the rendered DOM. Colour contrast is disabled because jsdom does not lay out
 * or paint, so contrast cannot be computed there; everything else runs.
 */
async function expectAxeClean(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
    preload: false, // no stylesheets to fetch in jsdom; avoids a 10 s preload timeout
  });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary).toEqual([]);
}

describe('accessibility (axe-core)', () => {
  let media: ReturnType<typeof stubMediaPlayback>;
  beforeEach(() => {
    media = stubMediaPlayback();
  });
  afterEach(() => {
    media.play.mockRestore();
    media.pause.mockRestore();
  });

  it('landing page has no axe violations and a skip link', async () => {
    const { container } = renderApp('/');
    await screen.findByRole('heading', { level: 1, name: /Game film to game plan/i });
    expect(screen.getByRole('link', { name: /Skip to content/ })).toHaveAttribute('href', '#main');
    await expectAxeClean(container);
  }, 60000);

  it('dashboard has no axe violations and headings in order', async () => {
    const { container } = renderApp('/app', { signedInAs: 'user-head' });
    await screen.findByRole('heading', { level: 1, name: /^Dashboard$/ });
    await screen.findByRole('region', { name: /Open tasks/ });
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    for (let i = 1; i < levels.length; i += 1) expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    await expectAxeClean(container);
  }, 60000);
});
