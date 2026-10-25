import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api, MediaGrantInfo } from '../api/api';

/** Refresh this long before `expiresAt` so playback never hits an expired token mid-seek. */
const REFRESH_MARGIN_MS = 60_000;

export interface GrantState {
  grant: MediaGrantInfo | null;
  status: 'loading' | 'ready' | 'error' | 'idle';
  error: unknown;
  /** Fetch a new grant now (the player calls this when the stream answers 401). */
  refresh: () => void;
}

/** `GET /assets/:id/grant` (§14.3), re-fetched before expiry and on demand. */
export function useGrant(api: Api, assetId: string | null, enabled: boolean): GrantState {
  const [grant, setGrant] = useState<MediaGrantInfo | null>(null);
  const [status, setStatus] = useState<GrantState['status']>('idle');
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!assetId || !enabled) {
      setStatus('idle');
      setGrant(null);
      return;
    }
    let active = true;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    api.media.grant(assetId).then(
      (g) => {
        if (!active) return;
        setGrant(g);
        setStatus('ready');
        setError(null);
        const inMs = Date.parse(g.expiresAt) - Date.now() - REFRESH_MARGIN_MS;
        if (Number.isFinite(inMs)) timer.current = setTimeout(() => setTick((t) => t + 1), Math.max(5_000, inMs));
      },
      (err: unknown) => {
        if (!active) return;
        setError(err);
        setStatus('error');
      },
    );
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [api, assetId, enabled, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { grant, status, error, refresh };
}
