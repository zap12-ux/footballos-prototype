import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { createApiClient } from '../lib/api';
import { FE, Q1, Q2, RUN, snapshot } from './fixtures';

/** Fake server: REST via the api client's fetchImpl, SSE via global fetch (the reader uses it). */
function fakeServer() {
  const submissions: Array<{ url: string; body: Record<string, unknown> }> = [];
  let conflictOnce = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const rest = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (auth !== 'Bearer FIXTURE-TOKEN') return json({ error: { code: 'unauthorized' } }, 401);
    if (url.startsWith('/api/runs')) return json({ runs: [snapshot().run] });
    if (url.startsWith('/api/state')) return json(snapshot());
    if (url.startsWith('/api/git/agents/')) return json({ branch: 'wt/x', ahead: 1, commits: [{ sha: 'abcdef1234', subject: 'FIXTURE commit' }], changedFiles: [{ status: 'M', path: 'src/x.ts' }, 'src/plain.ts'], mergedIntoIntegration: false });
    if (/\/api\/questions\/.+\/responses$/.test(url) && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      submissions.push({ url, body });
      if (conflictOnce) {
        conflictOnce = false;
        return json({ error: { code: 'conflict', message: 'superseded' } }, 409);
      }
      return json({ id: `resp-${submissions.length}`, questionId: url.split('/')[3], agentId: FE, taskId: 'F1', runId: RUN, questionVersion: body.questionVersion, option: body.option ?? null, text: body.text ?? null, state: 'submitted', createdAt: '2026-10-25T12:00:01.000Z', updatedAt: '2026-10-25T12:00:01.000Z' }, 201);
    }
    return json({ error: { code: 'not_found' } }, 404);
  });
  const stream = vi.fn(async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': hb 2026-10-25T12:00:00.000Z\n\n'));
        // keep open
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  return { rest, stream, submissions, setConflictOnce: () => (conflictOnce = true) };
}

describe('App', () => {
  let server: ReturnType<typeof fakeServer>;
  beforeEach(() => {
    server = fakeServer();
    vi.stubGlobal('fetch', server.stream);
    window.location.hash = '#token=FIXTURE-TOKEN';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderApp() {
    const api = createApiClient({ fetchImpl: server.rest as unknown as typeof fetch });
    return render(<App api={api} />);
  }

  it('captures the token from the hash, strips it, and shows the FIXTURE badge and queue', async () => {
    renderApp();
    expect(await screen.findByText('FIXTURE')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem('agentConsole.ownerToken')).toBe('FIXTURE-TOKEN');
    const queue = screen.getByRole('complementary', { name: 'Needs your input' });
    const items = within(queue).getAllByRole('button', { name: /Open question from/ });
    expect(items.map((b) => b.textContent)).toEqual([expect.stringContaining('console-ui'), expect.stringContaining('runtime')]);
    expect(within(items[0]).getByText('BLOCKING')).toBeInTheDocument();
  });

  it('queue click opens that agent\'s drawer at the question; submitting posts a fresh clientRequestId per attempt and handles 409', async () => {
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open question from console-ui' }));
    const drawer = await screen.findByRole('complementary', { name: /Details for console-ui/ });
    expect(within(drawer).getByText('Product Design / Frontend', { exact: false })).toBeInTheDocument();
    const card = within(drawer).getByTestId(`question-${Q1}`);
    expect(card).toHaveClass('highlight');
    expect(within(drawer).queryByTestId(`question-${Q2}`)).toBeNull();
    expect(within(drawer).getByText("Pause/stop/restart are only available to the lead's Claude Code session.")).toBeInTheDocument();
    await waitFor(() => expect(within(drawer).getByText('from git')).toBeInTheDocument());
    expect(await within(drawer).findByText('FIXTURE commit', { exact: false })).toBeInTheDocument();
    // changed files arrive as { status, path } from the server (v1.1) or as plain paths
    expect(within(drawer).getByText('src/x.ts', { exact: false })).toBeInTheDocument();
    expect(within(drawer).getByText('src/plain.ts')).toBeInTheDocument();

    server.setConflictOnce();
    await user.click(within(card).getByRole('radio', { name: /Alpha/ }));
    await user.click(within(card).getByRole('button', { name: 'Submit answer' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('This question was already answered or superseded');
    await user.click(within(card).getByRole('button', { name: 'Submit answer' }));
    await waitFor(() => expect(server.submissions).toHaveLength(2));
    const [first, second] = server.submissions;
    expect(first.body.clientRequestId).not.toBe(second.body.clientRequestId);
    expect(String(first.body.clientRequestId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.body).toMatchObject({ questionVersion: 1, option: 'Alpha' });
    expect(await within(card).findByText('Submitted')).toBeInTheDocument();
    // answered question leaves the queue
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open question from console-ui' })).toBeNull());
  });

  it('shows the no-token banner when the hash carries no token', async () => {
    window.location.hash = '';
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('No owner token');
  });
});
