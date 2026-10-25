/** Milliseconds between two ISO timestamps (b - a); NaN-safe. */
export function diffMs(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return tb - ta;
}

/** Compact relative phrase: "just now", "42s ago", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string | null | undefined, nowIso: string): string {
  const ms = diffMs(iso, nowIso);
  if (ms === null) return 'unknown';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function isStale(iso: string | null | undefined, nowIso: string, staleAfterMin: number): boolean {
  const ms = diffMs(iso, nowIso);
  if (ms === null) return false;
  return ms > staleAfterMin * 60_000;
}

/** Estimate the server clock now: server time at snapshot + local time elapsed since. */
export function serverNow(serverTimeAtSync: string | null, localAtSyncMs: number, localNowMs: number): string {
  const base = serverTimeAtSync ? Date.parse(serverTimeAtSync) : NaN;
  if (Number.isNaN(base)) return new Date(localNowMs).toISOString();
  return new Date(base + (localNowMs - localAtSyncMs)).toISOString();
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Round an ISO time down to a step (ms) so derived data does not change every tick. */
export function coarse(iso: string, stepMs = 30_000): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(Math.floor(t / stepMs) * stepMs).toISOString();
}
