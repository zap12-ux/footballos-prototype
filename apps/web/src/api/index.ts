import type { Api } from './api';
import { createHttpApi } from './http';
import { createMockApi } from './mock';

export type { Api, Me, SignInResult, TeamSettings, GamePlanBundle } from './api';
export { ApiError, isApiError } from './api';

export type ApiMode = 'mock' | 'http';

/** `VITE_API_MODE=mock|http` (default mock so the app runs without a server). */
export function resolveApiMode(raw: string | undefined = import.meta.env.VITE_API_MODE): ApiMode {
  return raw === 'http' ? 'http' : 'mock';
}

export function createApi(mode: ApiMode = resolveApiMode()): Api {
  return mode === 'http' ? createHttpApi() : createMockApi();
}
