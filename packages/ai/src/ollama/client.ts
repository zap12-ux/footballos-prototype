/**
 * Minimal typed client for the Ollama HTTP API (https://github.com/ollama/ollama/blob/main/docs/api.md).
 * Only the three calls the adapters need: `GET /api/version`, `POST /api/show` and a
 * non-streaming `POST /api/chat` with images and a JSON-schema `format`. Every failure is
 * mapped to `ProviderUnavailableError` with a reason the job runner and the coach can act on.
 */
import { Agent } from "undici";
import type { AiConfig } from "../config.js";
import { DEFAULT_AI_CONFIG } from "../config.js";
import { ProviderUnavailableError, type ProviderUnavailableReason } from "../errors.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OllamaClientOptions {
  /** Base URL, e.g. `http://127.0.0.1:11434` (already normalized by `loadAiConfig`). */
  host: string;
  fetchImpl?: FetchLike;
  /** Per-request timeout in milliseconds (default: `DEFAULT_AI_CONFIG.requestTimeoutMs`). */
  timeoutMs?: number;
}

export interface OllamaShowResult {
  /** e.g. `["completion", "vision"]`; absent on Ollama builds that predate the field. */
  capabilities: string[] | null;
  details: unknown;
}

export interface OllamaChatParams {
  model: string;
  /** System prompt (the versioned prompt file). */
  system: string;
  /** User text that follows the images. */
  prompt: string;
  /** Raw base64 images in the order they are referred to in `prompt`. */
  images: string[];
  /** JSON schema the response must satisfy (`format`). */
  format: Record<string, unknown>;
  numPredict: number;
  keepAlive: string;
  /** Context window for this call (`options.num_ctx`); Ollama's default (4096) is too small for several frames. */
  numCtx?: number;
  /**
   * `false` turns off the hidden reasoning of thinking-capable models (qwen3-vl). Without it such a
   * model spends its whole `num_predict` on reasoning and returns an empty, truncated answer. Only
   * sent when defined: models without the `thinking` capability reject the field.
   */
  think?: boolean;
}

export interface OllamaChatResult {
  /** The model that served the request, as Ollama reports it. */
  model: string;
  content: string;
  /** `stop` when the model finished, `length` when `num_predict` cut it off. */
  doneReason: string | null;
  promptEvalCount: number;
  evalCount: number;
  /** Server-side wall time in milliseconds, when reported. */
  totalDurationMs: number | null;
}

interface OllamaErrorBody {
  error?: string;
}

const PROVIDER = "ollama" as const;

export class OllamaClient {
  readonly host: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: OllamaClientOptions) {
    this.host = opts.host.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_AI_CONFIG.requestTimeoutMs;
    if (opts.fetchImpl) {
      this.fetchImpl = opts.fetchImpl;
    } else {
      // Node's fetch gives a server 300 s to answer with headers (undici's default); a non-streaming
      // Ollama chat over several frames on a CPU takes longer than that, and the failure would be
      // misreported as "not reachable". The client's own timeout is the only one that applies.
      const dispatcher = dispatcherFor(this.timeoutMs);
      this.fetchImpl = (input, init) => fetch(input, { ...init, dispatcher } as unknown as RequestInit);
    }
  }

  async version(): Promise<string> {
    const body = (await this.request("GET", "/api/version")) as { version?: unknown };
    return typeof body.version === "string" ? body.version : "unknown";
  }

  async show(model: string): Promise<OllamaShowResult> {
    const body = (await this.request("POST", "/api/show", { model }, { model })) as { capabilities?: unknown; details?: unknown };
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter((c): c is string => typeof c === "string") : null;
    return { capabilities, details: body.details ?? null };
  }

  async chat(params: OllamaChatParams): Promise<OllamaChatResult> {
    const body = (await this.request(
      "POST",
      "/api/chat",
      {
        model: params.model,
        stream: false,
        format: params.format,
        keep_alive: params.keepAlive,
        ...(params.think === undefined ? {} : { think: params.think }),
        options: { temperature: 0, num_predict: params.numPredict, ...(params.numCtx === undefined ? {} : { num_ctx: params.numCtx }) },
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.prompt, images: params.images },
        ],
      },
      { model: params.model },
    )) as {
      model?: unknown;
      message?: { content?: unknown };
      done_reason?: unknown;
      prompt_eval_count?: unknown;
      eval_count?: unknown;
      total_duration?: unknown;
    };
    const content = body.message?.content;
    if (typeof content !== "string") {
      throw new ProviderUnavailableError({ provider: PROVIDER, reason: "invalid_model_output", retryable: true, message: "Ollama response carried no message content" });
    }
    return {
      model: typeof body.model === "string" && body.model !== "" ? body.model : params.model,
      content,
      doneReason: typeof body.done_reason === "string" ? body.done_reason : null,
      promptEvalCount: nonNegativeInt(body.prompt_eval_count),
      evalCount: nonNegativeInt(body.eval_count),
      totalDurationMs: typeof body.total_duration === "number" && Number.isFinite(body.total_duration) ? Math.round(body.total_duration / 1e6) : null,
    };
  }

  private async request(method: "GET" | "POST", path: string, json?: unknown, ctx: { model?: string } = {}): Promise<unknown> {
    const url = `${this.host}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: json === undefined ? undefined : { "content-type": "application/json" },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw mapTransportError(err, this.host, this.timeoutMs);
    }
    if (!response.ok) throw await mapHttpError(response, this.host, ctx.model);
    try {
      return await response.json();
    } catch (err) {
      throw new ProviderUnavailableError({ provider: PROVIDER, reason: "invalid_model_output", retryable: true, message: `Ollama returned a non-JSON body for ${path}`, cause: err });
    }
  }
}

/** One connection pool per timeout for the whole process; `checkOllama` and the labelers share it. */
const DISPATCHERS = new Map<number, Agent>();
function dispatcherFor(timeoutMs: number): Agent {
  let agent = DISPATCHERS.get(timeoutMs);
  if (!agent) {
    agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs, connectTimeout: 10_000 });
    DISPATCHERS.set(timeoutMs, agent);
  }
  return agent;
}

function nonNegativeInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"]);
const REFUSED_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "EAI_AGAIN", "ENETUNREACH"]);

function nameOf(err: unknown): string | null {
  return typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string" ? (err as { name: string }).name : null;
}
function codeOf(err: unknown): string | null {
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : null;
}
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `fetch` threw: nothing (or nothing complete) was answered. Node wraps the real cause in
 * `TypeError: fetch failed`, so the cause's `code` decides: connection refused is "Ollama is not
 * running"; a timeout (ours or undici's) is "still working or too slow", which a later attempt with a
 * longer timeout or fewer frames can fix; anything else is a transient network fault.
 */
export function mapTransportError(err: unknown, host: string, timeoutMs: number): ProviderUnavailableError {
  if (err instanceof ProviderUnavailableError) return err;
  const cause = typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined;
  const names = [nameOf(err), nameOf(cause)];
  const codes = [codeOf(err), codeOf(cause)];
  const seconds = Math.round(timeoutMs / 1000);
  if (names.includes("TimeoutError") || names.includes("AbortError") || codes.some((c) => c !== null && TIMEOUT_CODES.has(c))) {
    return new ProviderUnavailableError({
      provider: PROVIDER,
      reason: "network",
      retryable: true,
      message: `Ollama at ${host} did not answer within ${seconds} s; the model may still be working. Raise FOOTBALLOS_AI_REQUEST_TIMEOUT_MS or lower FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT on a slow machine`,
      cause: err,
    });
  }
  const text = `${messageOf(err)} ${messageOf(cause)}`;
  if (codes.some((c) => c !== null && REFUSED_CODES.has(c)) || /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/.test(text)) {
    return new ProviderUnavailableError({
      provider: PROVIDER,
      reason: "unreachable",
      retryable: false,
      message: `Ollama is not reachable at ${host} (OLLAMA_HOST). Start it with \`ollama serve\` and try again`,
      cause: err,
    });
  }
  return new ProviderUnavailableError({ provider: PROVIDER, reason: "network", retryable: true, message: `connection to Ollama at ${host} failed: ${messageOf(cause ?? err)}`, cause: err });
}

/** The server answered with an error status. */
async function mapHttpError(response: Response, host: string, model: string | undefined): Promise<ProviderUnavailableError> {
  let detail = "";
  try {
    const text = await response.text();
    try {
      detail = ((JSON.parse(text) as OllamaErrorBody).error ?? "").trim();
    } catch {
      detail = text.slice(0, 200).trim();
    }
  } catch {
    detail = "";
  }
  const status = response.status;
  const base = { provider: PROVIDER, status } as const;
  const suffix = detail ? ` (${detail})` : "";
  if (status === 404 && model) {
    return new ProviderUnavailableError({ ...base, reason: "model_missing", retryable: false, message: `model ${model} is not installed in Ollama at ${host}; run \`ollama pull ${model}\`${suffix}` });
  }
  if (status === 404) {
    return new ProviderUnavailableError({ ...base, reason: "bad_request", retryable: false, message: `Ollama at ${host} does not serve this endpoint${suffix}` });
  }
  if (status === 400 || status === 422) {
    return new ProviderUnavailableError({ ...base, reason: "bad_request", retryable: false, message: `Ollama rejected the request${suffix}` });
  }
  if (status >= 500) {
    return new ProviderUnavailableError({ ...base, reason: "server_error", retryable: true, message: `Ollama server error ${status}${suffix}` });
  }
  return new ProviderUnavailableError({ ...base, reason: "unknown", retryable: false, message: `Ollama answered ${status}${suffix}` });
}

export type OllamaStatus =
  | { ok: true; host: string; version: string; model: string }
  | { ok: false; host: string; reason: ProviderUnavailableReason; message: string };

/**
 * Preflight before any frame is extracted: is the server up, is the model pulled, can it see?
 * Never throws; the caller turns `ok: false` into a truthful job failure.
 */
export async function checkOllama(config: Pick<AiConfig, "ollamaHost" | "model" | "requestTimeoutMs">, fetchImpl?: FetchLike): Promise<OllamaStatus> {
  const client = new OllamaClient({ host: config.ollamaHost, fetchImpl, timeoutMs: Math.min(config.requestTimeoutMs, 15_000) });
  try {
    const version = await client.version();
    const shown = await client.show(config.model);
    if (shown.capabilities !== null && !shown.capabilities.includes("vision")) {
      return {
        ok: false,
        host: client.host,
        reason: "model_not_vision",
        message: `model ${config.model} cannot take image input (capabilities: ${shown.capabilities.join(", ") || "none"}); set FOOTBALLOS_AI_MODEL to a vision model such as qwen3-vl:4b`,
      };
    }
    return { ok: true, host: client.host, version, model: config.model };
  } catch (err) {
    const mapped = err instanceof ProviderUnavailableError ? err : mapTransportError(err, client.host, config.requestTimeoutMs);
    return { ok: false, host: client.host, reason: mapped.reason, message: mapped.message };
  }
}

/** Rough token budget for one image in Qwen-class vision models (a 720p frame is about 1 000 to 1 500 tokens). */
const TOKENS_PER_IMAGE = 1400;

/**
 * Context window for one call: every image, the text (about 3 characters per token) and the
 * whole `num_predict`, rounded up to a 2 048 multiple, at least 4 096 and at most `maxNumCtx`.
 */
export function estimateNumCtx(input: { images: number; textChars: number; numPredict: number; maxNumCtx: number }): number {
  const needed = input.images * TOKENS_PER_IMAGE + Math.ceil(input.textChars / 3) + input.numPredict + 512;
  const rounded = Math.ceil(needed / 2048) * 2048;
  return Math.min(Math.max(rounded, 4096), Math.max(4096, input.maxNumCtx));
}

/**
 * Whether `think: false` must be sent for this model: once per labeler instance, from
 * `/api/show` capabilities. Ollama builds that predate `capabilities` get no `think` field.
 */
export async function thinkingOff(client: OllamaClient, model: string): Promise<boolean | undefined> {
  const shown = await client.show(model);
  return shown.capabilities?.includes("thinking") ? false : undefined;
}
