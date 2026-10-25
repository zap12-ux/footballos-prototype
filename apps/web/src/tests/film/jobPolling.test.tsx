import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Api } from '../../api/api';
import type { ProcessingJob } from '../../api/contracts';
import { useJobPolling } from '../../film/jobPolling';

const job = (status: ProcessingJob['status']): ProcessingJob =>
  ({ id: 'j', teamId: 't', assetId: 'a', kind: 'validate', status, progress: { done: 0, total: null, message: '' }, attempt: 1, maxAttempts: 3, leaseExpiresAt: null, workerId: null, idempotencyKey: 'k', configVersion: 'v', error: null, requestedBy: null, createdAt: '', startedAt: null, finishedAt: null, canceledAt: null }) as ProcessingJob;

describe('useJobPolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('polls every 3 s while a job is active and stops once every job is terminal', async () => {
    const answers = [[job('queued')], [job('running')], [job('succeeded')], [job('succeeded')]];
    const jobs = vi.fn(async () => answers[Math.min(jobs.mock.calls.length - 1, answers.length - 1)]);
    const api = { media: { jobs } } as unknown as Api;
    const { result } = renderHook(() => useJobPolling(api, 'team', 'a', 3000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(jobs).toHaveBeenCalledTimes(1);
    expect(jobs.mock.calls[0]).toEqual(['team', { assetId: 'a' }]);
    expect(result.current.polling).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(jobs).toHaveBeenCalledTimes(2);
    expect(result.current.jobs[0].status).toBe('running');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(jobs).toHaveBeenCalledTimes(3);
    expect(result.current.jobs[0].status).toBe('succeeded');
    expect(result.current.polling).toBe(false);
    // Idle: no further calls however long we wait.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(jobs).toHaveBeenCalledTimes(3);
    // reload() starts a fresh cycle (after "Run inference", say).
    await act(async () => {
      result.current.reload();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(jobs).toHaveBeenCalledTimes(4);
  });

  it('does not poll at all when every job is already finished', async () => {
    const jobs = vi.fn(async () => [job('failed'), job('canceled')]);
    const api = { media: { jobs } } as unknown as Api;
    const { result } = renderHook(() => useJobPolling(api, 'team', null, 3000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(jobs).toHaveBeenCalledTimes(1);
    expect(jobs.mock.calls[0]).toEqual(['team', {}]);
    expect(result.current.polling).toBe(false);
  });

  it('reports a failed poll instead of hiding it', async () => {
    const jobs = vi.fn(async () => {
      throw new Error('down');
    });
    const api = { media: { jobs } } as unknown as Api;
    const { result } = renderHook(() => useJobPolling(api, 'team', null, 3000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.polling).toBe(false);
  });
});
