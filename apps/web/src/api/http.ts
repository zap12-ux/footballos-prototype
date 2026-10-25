/**
 * HttpApi: the `Api` over `apps/api` (`/api/v1`), same-origin, cookie session (`fos_session`,
 * httpOnly). In development Vite proxies `/api` and `/media` to the API port.
 *
 * The client is `hc<AppType>` from `hono/client`, typed by the API's own route table
 * (`import type { AppType } from '@footballos/api'`, type-only: no runtime dependency on the
 * server package). Routes that exist in `AppType` are called through it, so a server-side
 * change to a path, parameter or response shape fails the web typecheck.
 *
 * CONTRACTS §14 routes (uploads, jobs, media grants, segments, labels, scouting, settings)
 * are being built by Backend in parallel and are not in `AppType` yet. They go through
 * `raw()`, typed by the §14 request/response shapes in `./api.ts` and `@footballos/contracts`.
 * When each route lands in `AppType`, its `raw()` call moves to `v1.…` (one line each).
 */
import { hc } from 'hono/client';
import type { AppType } from '@footballos/api';
import type { Api, Me, SignInResult, TeamSettings } from './api';
import { ApiError } from './api';
import type { ErrorEnvelope, ScheduledGame } from './contracts';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

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
  /** Origin or path prefix in front of `/api/v1`; empty (default) means same origin. */
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const UNREACHABLE = 'The server could not be reached. Check your connection and try again.';

/** Parse the §2 envelope of a failed response into an `ApiError`; never echoes raw bodies. */
async function toApiError(response: Response): Promise<ApiError> {
  let envelope: Partial<ErrorEnvelope> | null = null;
  try {
    const text = await response.text();
    envelope = text ? (JSON.parse(text) as Partial<ErrorEnvelope>) : null;
  } catch {
    envelope = null;
  }
  const error = envelope?.error;
  return new ApiError(error?.code ?? 'internal', error?.message ?? `Request failed (${response.status}).`, response.status, error?.details ?? {});
}

/** Keep the success members of a typed response union; a plain `Response` passes through. */
type OkOf<R> = R extends { ok: true } ? R : R extends { ok: false } ? never : R;
type JsonOf<R> = R extends { json(): Promise<infer T> } ? T : never;

export function createHttpApi(options: HttpApiOptions = {}): Api {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));

  const client = hc<AppType>(base, { fetch: fetchImpl, init: { credentials: 'include' } });
  const v1 = client.api.v1;

  /** Await a typed client call; network failures and non-2xx envelopes become `ApiError`. */
  async function ok<R extends Response>(pending: Promise<R>): Promise<OkOf<R>> {
    let response: R;
    try {
      response = await pending;
    } catch (error) {
      throw new ApiError('provider_unavailable', UNREACHABLE, 503, { retryable: true, cause: error instanceof Error ? error.message : String(error) });
    }
    if (!response.ok) throw await toApiError(response);
    return response as OkOf<R>;
  }

  /** The typed JSON body of a successful typed client call. */
  async function json<R extends Response>(pending: Promise<R>): Promise<JsonOf<OkOf<R>>> {
    const response = await ok(pending);
    return (await response.json()) as JsonOf<OkOf<R>>;
  }

  /** §14 routes not yet in `AppType`: same envelope handling, shapes from the contract. */
  async function raw<T>(method: Method, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (body !== undefined && !(body instanceof Blob)) headers.set('Content-Type', 'application/json');
    const response = await ok(
      fetchImpl(`${base}/api/v1${path}`, {
        ...init,
        method,
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
      }),
    );
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Lists arrive as `{ items, nextCursor }` (CONTRACTS §1); the shell reads the first page. */
  async function rawList<T>(path: string): Promise<T[]> {
    const data = await raw<{ items: T[]; nextCursor: string | null } | T[]>('GET', path);
    return Array.isArray(data) ? data : data.items;
  }

  const q = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, v);
    const s = search.toString();
    return s ? `?${s}` : '';
  };

  return {
    mode: 'http',
    auth: {
      async me() {
        try {
          const raw = (await json(v1.auth.me.$get())) as RawAuthState;
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
          const raw = (await json(v1.auth['sign-in'].$post({ json: input }))) as RawAuthState;
          if (raw.mfaRequired) return { kind: 'mfa_required' };
          return { kind: 'signed_in', me: toMe(raw) };
        } catch (error) {
          if (error instanceof ApiError && error.status === 401 && error.details.mfaRequired === true) return { kind: 'mfa_required' };
          throw error;
        }
      },
      async verifyMfa(input) {
        await ok(v1.auth.mfa.verify.$post({ json: input }));
        return toMe((await json(v1.auth.me.$get())) as RawAuthState);
      },
      async signOut() {
        await ok(v1.auth['sign-out'].$post());
      },
      async requestRecovery(input) {
        await ok(v1.auth.recovery.request.$post({ json: input }));
      },
    },
    teams: {
      list: async () => (await json(v1.teams.$get())).items,
      get: (teamId) => json(v1.teams[':teamId'].$get({ param: { teamId } })),
      async staff(teamId) {
        const members = (await json(v1.teams[':teamId'].staff.$get({ param: { teamId } }))).items;
        let invites: Awaited<ReturnType<Api['teams']['staff']>>['invites'] = [];
        try {
          invites = (await json(v1.teams[':teamId'].invites.$get({ param: { teamId } }))).items;
        } catch (error) {
          // Only the head coach may list invites (§3); everyone else sees the members alone.
          if (!(error instanceof ApiError && error.status === 403)) throw error;
        }
        return { members, invites };
      },
      invite: (teamId, input) => json(v1.teams[':teamId'].invites.$post({ param: { teamId }, json: input })),
      updateMembership: (teamId, membershipId, patch) => json(v1.teams[':teamId'].staff[':membershipId'].$patch({ param: { teamId, membershipId }, json: patch })),
      // §14.7 (proposed route adopted): `{ settings: { retentionDays, uploadLimits, version } }`.
      settings: async (teamId) => (await raw<{ settings: TeamSettings }>('GET', `/teams/${teamId}/settings`)).settings,
      updateSettings: async (teamId, patch) => (await raw<{ settings: TeamSettings }>('PATCH', `/teams/${teamId}/settings`, patch)).settings,
    },
    seasons: {
      list: async (teamId) => (await json(v1.teams[':teamId'].seasons.$get({ param: { teamId } }))).items,
      opponents: async (teamId) => (await json(v1.teams[':teamId'].opponents.$get({ param: { teamId } }))).items,
      games: async (teamId, seasonId) => (await json(v1.teams[':teamId'].seasons[':seasonId'].games.$get({ param: { teamId, seasonId } }))).items,
      createGame: (teamId, seasonId, input) => json(v1.teams[':teamId'].seasons[':seasonId'].games.$post({ param: { teamId, seasonId }, json: input })),
      updateGame: (gameId, patch) => json(v1.games[':gameId'].$patch({ param: { gameId }, json: patch })),
      previewImport: (teamId, seasonId, file) =>
        json(v1.teams[':teamId']['schedule-imports'].$post({ param: { teamId }, json: { seasonId, filename: file.name, content: file.text } })),
      async applyImport(importId) {
        const result = await json(v1['schedule-imports'][':id'].apply.$post({ param: { id: importId }, json: {} }));
        const { teamId, seasonId } = result.import;
        const games = (await json(v1.teams[':teamId'].seasons[':seasonId'].games.$get({ param: { teamId, seasonId } }))).items;
        return games.filter((g: ScheduledGame) => result.createdGameIds.includes(g.id));
      },
    },
    media: {
      assets: (gameId) => rawList(`/games/${gameId}/assets`),
      asset: async (assetId) => (await raw<{ asset: Awaited<ReturnType<Api['media']['asset']>> }>('GET', `/assets/${assetId}`)).asset,
      createUpload: (gameId, input) => raw('POST', `/games/${gameId}/uploads`, input),
      putChunk: (uploadId, range, body) =>
        raw('PUT', `/uploads/${uploadId}`, body, {
          headers: { 'Content-Range': `bytes ${range.start}-${range.end}/${range.total}`, 'Content-Type': 'application/octet-stream' },
        }),
      getUpload: async (uploadId) => (await raw<{ upload: Awaited<ReturnType<Api['media']['getUpload']>> }>('GET', `/uploads/${uploadId}`)).upload,
      completeUpload: (uploadId) => raw('POST', `/uploads/${uploadId}/complete`),
      deleteAsset: (assetId) => raw<void>('DELETE', `/assets/${assetId}`),
      grant: (assetId) => raw('GET', `/assets/${assetId}/grant`),
      jobs: (teamId, query = {}) => rawList(`/teams/${teamId}/jobs${q({ assetId: query.assetId, status: query.status, limit: '200' })}`),
      job: async (jobId) => (await raw<{ job: Awaited<ReturnType<Api['media']['job']>> }>('GET', `/jobs/${jobId}`)).job,
      cancelJob: async (jobId) => (await raw<{ job: Awaited<ReturnType<Api['media']['job']>> }>('POST', `/jobs/${jobId}/cancel`)).job,
      retryJob: async (jobId) => (await raw<{ job: Awaited<ReturnType<Api['media']['job']>> }>('POST', `/jobs/${jobId}/retry`)).job,
      segments: (assetId) => rawList(`/assets/${assetId}/segments`),
      splitSegment: (segmentId, input) => raw('POST', `/segments/${segmentId}/split`, input),
      mergeSegments: (input) => raw('POST', '/segments/merge', input),
      updateSegment: async (segmentId, patch) => (await raw<{ segment: Awaited<ReturnType<Api['media']['updateSegment']>> }>('PATCH', `/segments/${segmentId}`, patch)).segment,
      createSegment: async (assetId, input) => (await raw<{ segment: Awaited<ReturnType<Api['media']['createSegment']>> }>('POST', `/assets/${assetId}/segments`, input)).segment,
    },
    labels: {
      forAsset: (assetId) => rawList(`/assets/${assetId}/labels`),
      forSegment: (segmentId) => rawList(`/segments/${segmentId}/labels`),
      correct: async (labelId, input) => (await raw<{ label: Awaited<ReturnType<Api['labels']['correct']>> }>('PATCH', `/labels/${labelId}`, input)).label,
      revisions: (labelId) => rawList(`/labels/${labelId}/revisions`),
      bulkAccept: (assetId, input) => raw('POST', `/assets/${assetId}/labels/bulk-accept`, input),
      provenance: (assetId) => rawList(`/assets/${assetId}/provenance`),
      infer: async (assetId, input = {}) => (await raw<{ jobs: Awaited<ReturnType<Api['labels']['infer']>> }>('POST', `/assets/${assetId}/infer`, input)).jobs,
    },
    scouting: {
      report: (teamId, opponentId, query) =>
        raw('GET', `/teams/${teamId}/opponents/${opponentId}/scouting${q({ unit: query.unit, reviewBasis: query.reviewBasis, gameIds: query.gameIds?.join(',') })}`),
      snapshots: (teamId, opponentId) => rawList(`/teams/${teamId}/opponents/${opponentId}/scouting/snapshots`),
      saveSnapshot: async (teamId, opponentId, input) =>
        (await raw<{ snapshot: Awaited<ReturnType<Api['scouting']['saveSnapshot']>> }>('POST', `/teams/${teamId}/opponents/${opponentId}/scouting/snapshots`, input)).snapshot,
    },
    plans: {
      get: (gameId, unit) => raw('GET', `/games/${gameId}/plans/${unit}`),
      createDraft: (versionId) => raw('POST', `/plan-versions/${versionId}/draft`),
      update: (versionId, patch) => raw('PATCH', `/plan-versions/${versionId}`, patch),
      submit: (versionId) => raw('POST', `/plan-versions/${versionId}/submit`),
      approve: (versionId) => raw('POST', `/plan-versions/${versionId}/approve`),
      comment: (versionId, input) => raw('POST', `/plan-versions/${versionId}/comments`, input),
    },
    playbook: {
      documents: (teamId, unit) => rawList(`/teams/${teamId}/playbook/documents${q({ unit })}`),
      versions: (teamId, unit) => rawList(`/teams/${teamId}/playbook/versions${q({ unit })}`),
      concepts: (versionId) => rawList(`/playbook/versions/${versionId}/concepts`), // proposed route
      decideConcept: (conceptId, input) => raw('PATCH', `/concepts/${conceptId}`, input),
    },
    personnel: {
      players: (teamId, seasonId) => rawList(`/teams/${teamId}/seasons/${seasonId}/players`),
      depthChart: (teamId, seasonId, unit) => raw('GET', `/teams/${teamId}/seasons/${seasonId}/depth-chart${q({ unit })}`), // proposed GET
      packages: (teamId, seasonId, unit) => rawList(`/teams/${teamId}/seasons/${seasonId}/packages${q({ unit })}`),
    },
  };
}
