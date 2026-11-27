/**
 * Runtime configuration for the AI package. Everything has an explicit default and an
 * environment-variable override. The only model provider is a local Ollama server running
 * an open-source vision model; there is no API key and no per-call cost.
 */

export interface AiConfig {
  /** Base URL of the Ollama server (`OLLAMA_HOST`, Ollama's own convention). */
  ollamaHost: string;
  /** Ollama model tag, e.g. `qwen3-vl:4b`. Must be pulled (`ollama pull <tag>`) and support image input. */
  model: string;
  /** Upper bound on response tokens for one labeling call (`num_predict`). */
  maxOutputTokens: number;
  maxFramesPerSegment: number;
  maxSegmentsPerJob: number;
  /** Request timeout in milliseconds; local CPU inference on a dozen frames can take minutes. */
  requestTimeoutMs: number;
  /** Upper bound for the per-call context window (`num_ctx`); the adapters size each call to its frames and cap it here. */
  maxNumCtx: number;
  /** How long Ollama keeps the model loaded between calls (`keep_alive`), e.g. `10m`. */
  keepAlive: string;
}

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

export const DEFAULT_AI_CONFIG: Readonly<AiConfig> = Object.freeze({
  ollamaHost: DEFAULT_OLLAMA_HOST,
  // Qwen3-VL 4B fits an 8 GiB development machine; use `qwen3-vl:8b` on a server with 16 GiB or more.
  model: "qwen3-vl:4b",
  maxOutputTokens: 4096,
  maxFramesPerSegment: 12,
  maxSegmentsPerJob: 200,
  requestTimeoutMs: 300_000,
  maxNumCtx: 32_768,
  keepAlive: "10m",
});

function numberEnv(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * Normalize an `OLLAMA_HOST` value the way the Ollama CLI does: a bare `host:port` gets
 * `http://`, a trailing slash is dropped. Anything that is not a valid URL is rejected.
 */
export function normalizeOllamaHost(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return DEFAULT_OLLAMA_HOST;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`OLLAMA_HOST is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`OLLAMA_HOST must be http or https, got ${url.protocol}`);
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** Build the config from `process.env` (or an injected env) on top of the defaults. */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const keepAlive = env.FOOTBALLOS_AI_KEEP_ALIVE?.trim() || DEFAULT_AI_CONFIG.keepAlive;
  return {
    ollamaHost: normalizeOllamaHost(env.OLLAMA_HOST),
    model: env.FOOTBALLOS_AI_MODEL?.trim() || DEFAULT_AI_CONFIG.model,
    maxOutputTokens: numberEnv("FOOTBALLOS_AI_MAX_OUTPUT_TOKENS", DEFAULT_AI_CONFIG.maxOutputTokens, env),
    maxFramesPerSegment: numberEnv("FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT", DEFAULT_AI_CONFIG.maxFramesPerSegment, env),
    maxSegmentsPerJob: numberEnv("FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB", DEFAULT_AI_CONFIG.maxSegmentsPerJob, env),
    requestTimeoutMs: numberEnv("FOOTBALLOS_AI_REQUEST_TIMEOUT_MS", DEFAULT_AI_CONFIG.requestTimeoutMs, env),
    maxNumCtx: numberEnv("FOOTBALLOS_AI_MAX_NUM_CTX", DEFAULT_AI_CONFIG.maxNumCtx, env),
    keepAlive,
  };
}
