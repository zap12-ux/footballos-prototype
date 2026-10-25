const KEY = 'agentConsole.ownerToken';

/**
 * The owner token arrives once in the URL hash (`#token=…`). Move it into sessionStorage
 * and strip it from the address bar so it is not kept in history or screenshots.
 */
export function captureTokenFromHash(loc: Location = window.location, history: History = window.history): string | null {
  const hash = loc.hash.startsWith('#') ? loc.hash.slice(1) : loc.hash;
  if (!hash) return getToken();
  const params = new URLSearchParams(hash);
  const token = params.get('token');
  if (token) {
    try {
      sessionStorage.setItem(KEY, token);
    } catch {
      /* storage unavailable: token stays in memory only */
      memoryToken = token;
    }
    params.delete('token');
    const rest = params.toString();
    history.replaceState(null, '', loc.pathname + loc.search + (rest ? `#${rest}` : ''));
    return token;
  }
  return getToken();
}

let memoryToken: string | null = null;

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function clearToken(): void {
  memoryToken = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
