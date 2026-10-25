/**
 * HttpApi: the `Api` over `apps/api` (`/api/v1`, CONTRACTS §12), same-origin, cookie
 * session (`fos_session`, httpOnly). In development Vite proxies `/api` to the API port.
 *
 * PLANNED SWAP: once `@footballos/api` exports `AppType`, this file becomes
 * `hc<AppType>(base)` from `hono/client` (`import type { AppType } from '@footballos/api'`),
 * and the route strings below disappear in favour of the typed client. Until that package
 * exists there is nothing to import, so the request helper is the smallest thing that
 * honours the error envelope and the pagination shape.
 */
import type { Api, Me, SignInResult } from './api';
import { ApiError } from './api';
import type { ErrorEnvelope, ScheduledGame } from './contracts';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** `AuthState` as apps/api serializes it (`mfaRequired` rather than the shell's `mfaVerified`). */
interface RawAuthState {
  user: Me['user'];
  mfaRequired: boolean;
  mfaEnrollmentRequired?: boolean;
  memberships: Me['memberships'];
}

function toMe(raw: RawAuthState): Me {
  return { user: raw.user, mfaVerified: !raw.mfaRequired, memberships: raw.memberships };
}

export interface HttpApiOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createHttpApi(options: HttpApiOptions = {}): Api {
  const base = (options.baseUrl ?? '/api/v1').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        credentials: 'include',
        headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new ApiError('provider_unavailable', 'The server could not be reached. Check your connection and try again.', 503, {
        retryable: true,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!response.ok) {
      const envelope = json as Partial<ErrorEnvelope> | null;
      const error = envelope?.error;
      throw new ApiError(error?.code ?? 'internal', error?.message ?? `Request failed (${response.status}).`, response.status, error?.details ?? {});
    }
    return json as T;
  }

  /** Lists arrive as `{ items, nextCursor }` (CONTRACTS §1); the shell reads the first page. */
  async function list<T>(path: string): Promise<T[]> {
    const data = await request<{ items: T[]; nextCursor: string | null } | T[]>('GET', path);
    return Array.isArray(data) ? data : data.items;
  }

  const q = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

  return {
    mode: 'http',
    auth: {
      async me() {
        try {
          const raw = await request<RawAuthState>('GET', '/auth/me');
          // A session whose MFA step is still pending is not usable for the workspace; the
          // sign-in page starts over (a new sign-in issues a fresh session). Known limitation.
          if (raw.mfaRequired) return null;
          return toMe(raw);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) return null;
          throw error;
        }
      },
      async signIn(input): Promise<SignInResult> {
        try {
          // apps/api answers 200 with `mfaRequired: true` when the password was accepted and
          // the authenticator code is still needed (CONTRACTS §13); the §2 401 form is kept too.
          const raw = await request<RawAuthState>('POST', '/auth/sign-in', input);
          if (raw.mfaRequired) return { kind: 'mfa_required' };
          return { kind: 'signed_in', me: toMe(raw) };
        } catch (error) {
          if (error instanceof ApiError && error.status === 401 && error.details.mfaRequired === true) return { kind: 'mfa_required' };
          throw error;
        }
      },
      async verifyMfa(input) {
        await request<unknown>('POST', '/auth/mfa/verify', input);
        return toMe(await request<RawAuthState>('GET', '/auth/me'));
      },
      signOut: () => request<void>('POST', '/auth/sign-out'),
      requestRecovery: (input) => request<void>('POST', '/auth/recovery/request', input),
    },
    teams: {
      list: () => list('/teams'),
      get: (teamId) => request('GET', `/teams/${teamId}`),
      staff: (teamId) => request('GET', `/teams/${teamId}/staff`),
      invite: (teamId, input) => request('POST', `/teams/${teamId}/invites`, input),
      updateMembership: (teamId, membershipId, patch) => request('PATCH', `/teams/${teamId}/staff/${membershipId}`, patch),
      // Proposed routes (not in CONTRACTS §12 yet): see the A2 handoff.
      settings: (teamId) => request('GET', `/teams/${teamId}/settings`),
      updateSettings: (teamId, patch) => request('PATCH', `/teams/${teamId}/settings`, patch),
    },
    seasons: {
      list: (teamId) => list(`/teams/${teamId}/seasons`),
      opponents: (teamId) => list(`/teams/${teamId}/opponents`), // proposed route
      games: (teamId, seasonId) => list(`/teams/${teamId}/seasons/${seasonId}/games`),
      createGame: (teamId, seasonId, input) => request('POST', `/teams/${teamId}/seasons/${seasonId}/games`, input),
      updateGame: (gameId, patch) => request('PATCH', `/games/${gameId}`, patch),
      previewImport: (teamId, seasonId, file) => request('POST', `/teams/${teamId}/schedule-imports`, { seasonId, filename: file.name, content: file.text }),
      applyImport: async (importId) => {
        const data = await request<{ items: ScheduledGame[] } | ScheduledGame[]>('POST', `/schedule-imports/${importId}/apply`);
        return Array.isArray(data) ? data : data.items;
      },
    },
    media: {
      assets: (gameId) => list(`/games/${gameId}/assets`), // proposed route (§12 has GET /assets/:id)
      createUpload: (gameId, input) => request('POST', `/games/${gameId}/uploads`, input),
      jobs: (teamId) => list(`/teams/${teamId}/jobs`),
      segments: (assetId) => list(`/assets/${assetId}/segments`),
    },
    scouting: {
      findings: (teamId, opponentId, unit) => list(`/teams/${teamId}/opponents/${opponentId}/scouting${q({ unit })}`),
    },
    plans: {
      get: (gameId, unit) => request('GET', `/games/${gameId}/plans/${unit}`),
      createDraft: (versionId) => request('POST', `/plan-versions/${versionId}/draft`),
      update: (versionId, patch) => request('PATCH', `/plan-versions/${versionId}`, patch),
      submit: (versionId) => request('POST', `/plan-versions/${versionId}/submit`),
      approve: (versionId) => request('POST', `/plan-versions/${versionId}/approve`),
      comment: (versionId, input) => request('POST', `/plan-versions/${versionId}/comments`, input),
    },
    playbook: {
      documents: (teamId, unit) => list(`/teams/${teamId}/playbook/documents${q({ unit })}`),
      versions: (teamId, unit) => list(`/teams/${teamId}/playbook/versions${q({ unit })}`),
      concepts: (versionId) => list(`/playbook/versions/${versionId}/concepts`), // proposed route
      decideConcept: (conceptId, input) => request('PATCH', `/concepts/${conceptId}`, input),
    },
    personnel: {
      players: (teamId, seasonId) => list(`/teams/${teamId}/seasons/${seasonId}/players`),
      depthChart: (teamId, seasonId, unit) => request('GET', `/teams/${teamId}/seasons/${seasonId}/depth-chart${q({ unit })}`), // proposed GET
      packages: (teamId, seasonId, unit) => list(`/teams/${teamId}/seasons/${seasonId}/packages${q({ unit })}`),
    },
  };
}
