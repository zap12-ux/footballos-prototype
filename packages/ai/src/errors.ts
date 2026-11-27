import type { Provider } from "./types.js";

export type ProviderUnavailableReason =
  /** The Ollama server did not answer at the configured host (connection refused, DNS). */
  | "unreachable"
  /** The configured model tag is not installed in Ollama (`ollama pull <model>`). */
  | "model_missing"
  /** The configured model cannot take image input. */
  | "model_not_vision"
  /** A transient transport problem (timeout, reset) after the server was reached. */
  | "network"
  | "server_error"
  | "bad_request"
  | "truncated_output"
  | "invalid_model_output"
  | "input_rejected"
  | "canceled"
  | "unknown";

/**
 * The only error a VisionLabeler raises. `retryable` tells the job runner whether a later
 * attempt could succeed (timeout, 5xx, a fresh sample) or not (server down, model missing,
 * bad input). There is never a canned or default label: when this is thrown, no label was produced.
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
