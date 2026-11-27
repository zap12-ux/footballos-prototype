import type { Api } from './api';
import { createHttpApi } from './http';

export type { Api, Me, SignInResult, TeamSettings, GamePlanBundle } from './api';
export { ApiError, isApiError } from './api';

/**
 * The one application API: `apps/api` over HTTP (`/api/v1`, cookie session). In development
 * Vite proxies `/api` and `/media` to the API port; `VITE_API_BASE_URL` points the client at
 * another origin when the web app is served from elsewhere.
 */
export function createApi(): Api {
  return createHttpApi({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });
}
