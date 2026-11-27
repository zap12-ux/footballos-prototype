/**
 * HttpApi: the `Api` over `apps/api` (`/api/v1`), same-origin, cookie session (`fos_session`,
 * httpOnly). In development Vite proxies `/api` and `/media` to the API port.
 *
 * The client is `hc<AppType>` from `hono/client`, typed by the API's own route table
 * (`import type { AppType } from '@footballos/api'`, type-only: no runtime dependency on the
 * server package). Routes that exist in `AppType` are called through it, so a server-side
 * change to a path, parameter or response shape fails the web typecheck.
 *
 * Every CONTRACTS §12/§14 route the API implements today (auth, teams, schedule, uploads,
 * jobs, media grants, segments, labels, scouting, settings) goes through the typed client.
 * Routes the API has not implemented yet (plans, playbook, personnel) go through `raw()`,
 * typed by the shapes in `./api.ts`, and move to `v1.…` as each lands in `AppType`.
 */
import { hc } from 'hono/client';
import type { AppType } from '@footballos/api';
import type { Api, Me, SignInResult } from './api';
import { ApiError } from './api';
import type { ErrorEnvelope, GamePlanResponse, PlanComment, PlanVersionResponse, ScheduledGame } from './contracts';

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
      // §14.7: upload limits are server configuration; only `retentionDays` is writable.
      settings: async (teamId) => (await json(v1.teams[':teamId'].settings.$get({ param: { teamId } }))).settings,
      updateSettings: async (teamId, patch) =>
        (await json(v1.teams[':teamId'].settings.$patch({ param: { teamId }, json: { expectedVersion: patch.expectedVersion, ...(patch.retentionDays !== undefined ? { retentionDays: patch.retentionDays } : {}) } }))).settings,
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
      assets: async (gameId) => (await json(v1.games[':gameId'].assets.$get({ param: { gameId } }))).items,
      asset: async (assetId) => (await json(v1.assets[':assetId'].$get({ param: { assetId } }))).asset,
      createUpload: (gameId, input) => json(v1.games[':gameId'].uploads.$post({ param: { gameId }, json: input })),
      // Raw body: hono/client sets `body` from `json`/`form` only, so the Blob goes through `init`.
      putChunk: (uploadId, range, body) =>
        json(
          v1.uploads[':uploadId'].$put(
            { param: { uploadId } },
            { headers: { 'Content-Range': `bytes ${range.start}-${range.end}/${range.total}`, 'Content-Type': 'application/octet-stream' }, init: { body } },
          ),
        ),
      getUpload: async (uploadId) => (await json(v1.uploads[':uploadId'].$get({ param: { uploadId } }))).upload,
      completeUpload: (uploadId) => json(v1.uploads[':uploadId'].complete.$post({ param: { uploadId }, json: {} })),
      deleteAsset: async (assetId) => {
        await ok(v1.assets[':assetId'].$delete({ param: { assetId } }));
      },
      grant: (assetId) => json(v1.assets[':assetId'].grant.$get({ param: { assetId } })),
      jobs: async (teamId, query = {}) =>
        (await json(v1.teams[':teamId'].jobs.$get({ param: { teamId }, query: { ...(query.assetId ? { assetId: query.assetId } : {}), ...(query.status ? { status: query.status } : {}), limit: '200' } }))).items,
      job: async (jobId) => (await json(v1.jobs[':jobId'].$get({ param: { jobId } }))).job,
      cancelJob: async (jobId) => (await json(v1.jobs[':jobId'].cancel.$post({ param: { jobId } }))).job,
      retryJob: async (jobId) => (await json(v1.jobs[':jobId'].retry.$post({ param: { jobId } }))).job,
      segments: async (assetId) => (await json(v1.assets[':assetId'].segments.$get({ param: { assetId } }))).items,
      splitSegment: (segmentId, input) => json(v1.segments[':segmentId'].split.$post({ param: { segmentId }, json: input })),
      mergeSegments: (input) => json(v1.segments.merge.$post({ json: input })),
      updateSegment: async (segmentId, patch) => (await json(v1.segments[':segmentId'].$patch({ param: { segmentId }, json: patch }))).segment,
      createSegment: async (assetId, input) => (await json(v1.assets[':assetId'].segments.$post({ param: { assetId }, json: input }))).segment,
    },
    labels: {
      forAsset: async (assetId) => (await json(v1.assets[':assetId'].labels.$get({ param: { assetId } }))).items,
      forSegment: async (segmentId) => (await json(v1.segments[':segmentId'].labels.$get({ param: { segmentId } }))).items,
      correct: async (labelId, input) => (await json(v1.labels[':labelId'].$patch({ param: { labelId }, json: input }))).label,
      revisions: async (labelId) => (await json(v1.labels[':labelId'].revisions.$get({ param: { labelId } }))).items,
      bulkAccept: (assetId, input) => json(v1.assets[':assetId'].labels['bulk-accept'].$post({ param: { assetId }, json: input })),
      provenance: async (assetId) => (await json(v1.assets[':assetId'].provenance.$get({ param: { assetId } }))).items,
      infer: async (assetId, input = {}) => (await json(v1.assets[':assetId'].infer.$post({ param: { assetId }, json: input }))).jobs,
    },
    scouting: {
      report: (teamId, opponentId, query) =>
        json(
          v1.teams[':teamId'].opponents[':opponentId'].scouting.$get({
            param: { teamId, opponentId },
            query: { unit: query.unit, reviewBasis: query.reviewBasis, ...(query.gameIds?.length ? { gameIds: query.gameIds.join(',') } : {}) },
          }),
        ),
      snapshots: async (teamId, opponentId) => (await json(v1.teams[':teamId'].opponents[':opponentId'].scouting.snapshots.$get({ param: { teamId, opponentId } }))).items,
      saveSnapshot: async (teamId, opponentId, input) =>
        (await json(v1.teams[':teamId'].opponents[':opponentId'].scouting.snapshots.$post({ param: { teamId, opponentId }, json: input }))).snapshot,
    },
    plans: {
      /**
       * §15.4: the API answers `{ plan, versions (summaries without sections), current, reviewFlags }`
       * and keeps comments per version; the screens want every version with its sections and the
       * comments of all versions in one bundle, so the summaries are expanded here.
       */
      async get(gameId, unit) {
        const bundle = await raw<GamePlanResponse>('GET', `/games/${gameId}/plans/${unit}`);
        const versions = await Promise.all(
          bundle.versions.map((summary) =>
            summary.id === bundle.current.id ? Promise.resolve(bundle.current) : raw<PlanVersionResponse>('GET', `/plan-versions/${summary.id}`).then((r) => r.version),
          ),
        );
        const comments = (await Promise.all(versions.map((v) => raw<{ items: PlanComment[] }>('GET', `/plan-versions/${v.id}/comments`)))).flatMap((r) => r.items);
        return { plan: bundle.plan, versions, comments };
      },
      createDraft: async (versionId) => (await raw<PlanVersionResponse>('POST', `/plan-versions/${versionId}/draft`)).version,
      update: async (versionId, patch) => (await raw<PlanVersionResponse>('PATCH', `/plan-versions/${versionId}`, patch)).version,
      submit: async (versionId) => (await raw<PlanVersionResponse>('POST', `/plan-versions/${versionId}/submit`)).version,
      approve: async (versionId, input = {}) => (await raw<PlanVersionResponse>('POST', `/plan-versions/${versionId}/approve`, input)).version,
      comment: async (versionId, input) => (await raw<{ comment: PlanComment }>('POST', `/plan-versions/${versionId}/comments`, input)).comment,
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
