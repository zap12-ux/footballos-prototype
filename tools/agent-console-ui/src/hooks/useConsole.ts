import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionStatus, QuestionResponse, Run } from '../types';
import { createApiClient, HttpError, type ApiClient } from '../lib/api';
import { captureTokenFromHash, getToken } from '../lib/auth';
import { SseReader } from '../lib/sse';
import { applyEvents, initialState, loadSnapshot, touchHeartbeat, type ConsoleState } from '../lib/store';
import { serverNow } from '../lib/time';
import { loadSelectedRun, saveSelectedRun } from '../lib/storage';
import { uuid } from '../lib/uuid';

export interface SubmitInput {
  option?: string | null;
  text?: string;
}

export type SubmitOutcome = { ok: true; response: QuestionResponse } | { ok: false; code: 'conflict' | 'unauthorized' | 'validation_error' | 'error'; message: string };

export interface ConsoleController {
  state: ConsoleState;
  runs: Run[];
  selectedRunId: string | null;
  selectRun: (runId: string) => void;
  connection: ConnectionStatus;
  lastSeq: number;
  nowIso: string;
  authError: boolean;
  loadError: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  submitResponse: (questionId: string, questionVersion: number, input: SubmitInput) => Promise<SubmitOutcome>;
  api: ApiClient;
}

function pickDefaultRun(runs: Run[], remembered: string | null): string | null {
  if (remembered && runs.some((r) => r.id === remembered)) return remembered;
  const live = runs.filter((r) => r.kind === 'live').sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  if (live[0]) return live[0].id;
  const any = [...runs].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return any[0]?.id ?? null;
}

export function useConsole(apiOverride?: ApiClient): ConsoleController {
  const api = useMemo(() => apiOverride ?? createApiClient(), [apiOverride]);
  const [state, setState] = useState<ConsoleState>(initialState);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [lastSeq, setLastSeq] = useState(0);
  const [authError, setAuthError] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const readerRef = useRef<SseReader | null>(null);

  useEffect(() => {
    captureTokenFromHash();
    if (!getToken()) {
      setAuthError(true);
      setLoading(false);
    }
  }, []);

  // Clock for relative times (server-referenced).
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const nowIso = useMemo(() => serverNow(state.serverTimeAtSync, state.localAtSyncMs, Date.now()), [state.serverTimeAtSync, state.localAtSyncMs, tick]);

  const handleHttpError = useCallback((err: unknown) => {
    if (err instanceof HttpError && err.status === 401) {
      setAuthError(true);
      return 'Unauthorized: open the console from the URL printed by the server (it carries the owner token).';
    }
    return err instanceof Error ? err.message : String(err);
  }, []);

  const fetchRuns = useCallback(async () => {
    const { runs: list } = await api.getRuns();
    setRuns(list ?? []);
    return list ?? [];
  }, [api]);

  const fetchSnapshot = useCallback(
    async (runId: string | null) => {
      const snap = await api.getState(runId ?? undefined);
      setState((s) => loadSnapshot(s, snap));
      if (snap.run?.id && snap.run.id !== runId) setSelectedRunId(snap.run.id);
      return snap;
    },
    [api],
  );

  // Initial load: runs, then snapshot for the default run.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await fetchRuns();
        if (cancelled) return;
        const runId = pickDefaultRun(list, loadSelectedRun());
        setSelectedRunId(runId);
        await fetchSnapshot(runId);
        setLoadError(null);
      } catch (err) {
        if (!cancelled) setLoadError(handleHttpError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchRuns, fetchSnapshot, handleHttpError]);

  // Stream for the selected run. Full replay (after=0) rebuilds the activity history from the
  // server; the store treats events the snapshot already covers as history-only.
  useEffect(() => {
    const runId = selectedRunId;
    if (!runId || !getToken()) return;
    readerRef.current?.stop();
    const reader = new SseReader({
      url: (after) => `/api/stream?runId=${encodeURIComponent(runId)}&after=${after}`,
      headers: () => api.headers(),
      initialSeq: 0,
      onEvents: (events) => {
        setState((s) => applyEvents(s, events));
        setLastSeq(events[events.length - 1].seq);
      },
      onHeartbeat: (iso) => setState((s) => touchHeartbeat(s, iso)),
      onStatus: (status, info) => {
        setConnection(status);
        setLastSeq((prev) => Math.max(prev, info.lastSeq));
      },
      onReconnected: () => {
        void fetchSnapshot(runId).catch((err) => setLoadError(handleHttpError(err)));
      },
      onUnauthorized: () => setAuthError(true),
    });
    readerRef.current = reader;
    reader.start();
    return () => {
      reader.stop();
      if (readerRef.current === reader) readerRef.current = null;
    };
  }, [selectedRunId, api, fetchSnapshot, handleHttpError]);

  const selectRun = useCallback(
    (runId: string) => {
      saveSelectedRun(runId);
      setSelectedRunId(runId);
      setState(initialState());
      setLastSeq(0);
      void fetchSnapshot(runId).catch((err) => setLoadError(handleHttpError(err)));
    },
    [fetchSnapshot, handleHttpError],
  );

  const refresh = useCallback(async () => {
    try {
      await fetchRuns();
      await fetchSnapshot(selectedRunId);
      setLoadError(null);
    } catch (err) {
      setLoadError(handleHttpError(err));
    }
  }, [fetchRuns, fetchSnapshot, selectedRunId, handleHttpError]);

  const submitResponse = useCallback(
    async (questionId: string, questionVersion: number, input: SubmitInput): Promise<SubmitOutcome> => {
      const body: { clientRequestId: string; questionVersion: number; text?: string; option?: string } = {
        clientRequestId: uuid(), // one id per attempt (CONTRACT §6)
        questionVersion,
      };
      if (input.option) body.option = input.option;
      if (input.text && input.text.trim()) body.text = input.text.trim();
      try {
        const raw = await api.submitResponse(questionId, body);
        const response = (raw && typeof raw === 'object' && 'response' in raw ? (raw as { response: QuestionResponse }).response : raw) as QuestionResponse;
        // Reflect immediately; the response.submitted event will confirm.
        setState((s) => {
          if (!s.snapshot || !response?.id) return s;
          const exists = s.snapshot.responses.some((r) => r.id === response.id);
          return {
            ...s,
            snapshot: {
              ...s.snapshot,
              responses: exists ? s.snapshot.responses : [...s.snapshot.responses, response],
              questions: s.snapshot.questions.map((q) => (q.id === questionId && q.status === 'open' ? { ...q, status: 'answered' } : q)),
            },
          };
        });
        return { ok: true, response };
      } catch (err) {
        if (err instanceof HttpError) {
          if (err.status === 409) {
            void fetchSnapshot(selectedRunId).catch(() => undefined);
            return { ok: false, code: 'conflict', message: 'This question was already answered or superseded' };
          }
          if (err.status === 401) {
            setAuthError(true);
            return { ok: false, code: 'unauthorized', message: 'Unauthorized' };
          }
          if (err.status === 400) return { ok: false, code: 'validation_error', message: err.message };
        }
        return { ok: false, code: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    },
    [api, fetchSnapshot, selectedRunId],
  );

  return { state, runs, selectedRunId, selectRun, connection, lastSeq, nowIso, authError, loadError, loading, refresh, submitResponse, api };
}
