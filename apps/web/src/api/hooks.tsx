import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Api } from './api';
import { ApiError } from './api';

const ApiContext = createContext<Api | null>(null);

export function ApiProvider({ api, children }: { api: Api; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}

/** A coach-readable message for any thrown value; never echoes server internals. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Try again.';
}

export type ResourceState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: unknown };

/**
 * Load one resource for a screen. Re-runs when `deps` change, ignores stale results, and
 * exposes `reload` for recovery buttons. No caching: every screen states its own data.
 */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[]): ResourceState<T> & { reload: () => void } {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading', data: null, error: null });
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let active = true;
    setState({ status: 'loading', data: null, error: null });
    loaderRef.current().then(
      (data) => {
        if (active) setState({ status: 'ready', data, error: null });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', data: null, error });
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export type ActionStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Run a write with visible saving / saved / error states. `saved` clears itself. */
export function useAction<Args extends unknown[], R>(fn: (...args: Args) => Promise<R>, options: { savedForMs?: number } = {}) {
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [error, setError] = useState<unknown>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const run = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      setStatus('saving');
      setError(null);
      try {
        const result = await fnRef.current(...args);
        setStatus('saved');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), options.savedForMs ?? 2500);
        return result;
      } catch (err) {
        setError(err);
        setStatus('error');
        return undefined;
      }
    },
    [options.savedForMs],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { run, status, error, reset };
}
