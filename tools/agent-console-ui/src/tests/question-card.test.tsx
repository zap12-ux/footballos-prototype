import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionCard } from '../components/QuestionCard';
import { createApiClient, HttpError } from '../lib/api';
import { loadDraft } from '../lib/storage';
import { FE, NOW, Q1, question } from './fixtures';
import type { SubmitOutcome } from '../hooks/useConsole';

const q = question({ id: Q1, agentId: FE, taskId: 'F1', blocking: true, questionVersion: 3 });

function renderCard(onSubmit: (id: string, v: number, input: { option?: string | null; text?: string }) => Promise<SubmitOutcome>, over: Partial<typeof q> = {}) {
  return render(<QuestionCard question={{ ...q, ...over }} agent={null} task={null} responses={[]} nowIso={NOW} onSubmit={onSubmit} />);
}

describe('QuestionCard', () => {
  it('renders options as radios with the recommendation marked and a labelled free-text field', () => {
    renderCard(vi.fn());
    expect(screen.getByRole('radio', { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByText('RECOMMENDED')).toBeInTheDocument();
    expect(screen.getByLabelText(/Your answer/)).toBeInTheDocument();
    expect(screen.getByText('BLOCKING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
  });

  it('submits option, text and the question version; disables the control while in flight', async () => {
    let resolve!: (v: SubmitOutcome) => void;
    const onSubmit = vi.fn(() => new Promise<SubmitOutcome>((r) => (resolve = r)));
    renderCard(onSubmit);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Beta/ }));
    await user.type(screen.getByLabelText(/Your answer/), 'because');
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(onSubmit).toHaveBeenCalledWith(Q1, 3, { option: 'Beta', text: 'because' });
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    resolve({ ok: true, response: { id: 'r', questionId: Q1 } as never });
    await waitFor(() => expect(loadDraft(Q1)).toBeNull());
  });

  it('shows the 409 message from the controller', async () => {
    const onSubmit = vi.fn(async (): Promise<SubmitOutcome> => ({ ok: false, code: 'conflict', message: 'This question was already answered or superseded' }));
    renderCard(onSubmit);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Alpha/ }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This question was already answered or superseded');
  });

  it('preserves an unfinished draft per question across unmount/remount', async () => {
    const onSubmit = vi.fn();
    const { unmount } = renderCard(onSubmit);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /Beta/ }));
    await user.type(screen.getByLabelText(/Your answer/), 'partial');
    expect(loadDraft(Q1)).toMatchObject({ option: 'Beta', text: 'partial' });
    unmount();
    renderCard(onSubmit);
    expect(screen.getByRole('radio', { name: /Beta/ })).toBeChecked();
    expect(screen.getByLabelText(/Your answer/)).toHaveValue('partial');
    expect(loadDraft('other')).toBeNull();
  });
});

describe('api client submission', () => {
  it('sends the bearer header and a JSON body, and surfaces 409 as HttpError', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ error: { code: 'conflict', message: 'stale version' } }), { status: 409 });
    });
    const api = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch, tokenProvider: () => 'T' });
    await expect(api.submitResponse(Q1, { clientRequestId: 'c1', questionVersion: 1, option: 'Alpha' })).rejects.toSatisfy((e: unknown) => e instanceof HttpError && e.status === 409 && e.code === 'conflict');
    expect(calls[0].url).toBe(`/api/questions/${Q1}/responses`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer T');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ clientRequestId: 'c1', questionVersion: 1, option: 'Alpha' });
  });
});
