import type { Provider } from "./types.js";

export type ProviderUnavailableReason =
  | "no_api_key"
  | "not_implemented"
  | "auth"
  | "rate_limited"
  | "network"
  | "server_error"
  | "bad_request"
  | "refusal"
  | "truncated_output"
  | "invalid_model_output"
  | "budget_exceeded"
  | "input_rejected"
  | "unknown";

/**
 * The only error a VisionLabeler raises. `retryable` tells the job runner whether a later
 * attempt could succeed (rate limit, network, 5xx) or not (no key, refusal, bad input).
 * There is never a canned or default label: when this is thrown, no label was produced.
 */
export class ProviderUnavailableError extends Error {
  readonly code = "provider_unavailable" as const;
  readonly provider: Provider;
  readonly reason: ProviderUnavailableReason;
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(opts: {
    provider: Provider;
    reason: ProviderUnavailableReason;
    retryable: boolean;
    message: string;
    status?: number | null;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "ProviderUnavailableError";
    this.provider = opts.provider;
    this.reason = opts.reason;
    this.retryable = opts.retryable;
    this.status = opts.status ?? null;
  }

  /** Shape for ProcessingJob.error (CONTRACTS §5). */
  toJobError(): { code: string; message: string } {
    return { code: this.code, message: `${this.reason}: ${this.message}` };
  }
}

export function isProviderUnavailable(err: unknown): err is ProviderUnavailableError {
  return err instanceof ProviderUnavailableError;
}
