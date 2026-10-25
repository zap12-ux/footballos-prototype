import type { ApiError, GitInfo, Question, QuestionResponse, Run, StateSnapshot } from '../types';
import { getToken } from './auth';

export class HttpError extends Error {
  readonly status: number;
  readonly body: ApiError | null;
  constructor(status: number, body: ApiError | null, message?: string) {
    super(message ?? body?.error?.message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
  get code(): string | undefined {
    return this.body?.error?.code;
  }
}

export type FetchLike = typeof fetch;

export interface ApiClientOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  tokenProvider?: () => string | null;
}

/** Thin fetch wrapper: same-origin `/api`, bearer header on every request, JSON envelope errors. */
export function createApiClient(opts: ApiClientOptions = {}) {
  const base = opts.baseUrl ?? '';
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((...args) => fetch(...args));
  const token = opts.tokenProvider ?? getToken;

  function headers(extra?: Record<string, string>): Record<string, string> {
    const t = token();
    return { Accept: 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(extra ?? {}) };
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(base + path, {
      method,
      headers: headers(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) throw new HttpError(res.status, (json as ApiError | null) ?? null);
    return json as T;
  }

  return {
    headers,
    getRuns: () => request<{ runs: Run[] }>('GET', '/api/runs'),
    getState: (runId?: string) => request<StateSnapshot>('GET', `/api/state${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`),
    getOpenQuestions: (runId?: string) =>
      request<{ questions: Question[] }>('GET', `/api/questions?status=open${runId ? `&runId=${encodeURIComponent(runId)}` : ''}`),
    getGit: (agentId: string) => request<GitInfo>('GET', `/api/git/agents/${encodeURIComponent(agentId)}`),
    submitResponse: (
      questionId: string,
      body: { clientRequestId: string; questionVersion: number; text?: string; option?: string },
    ) => request<QuestionResponse | { response: QuestionResponse }>('POST', `/api/questions/${encodeURIComponent(questionId)}/responses`, body),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
