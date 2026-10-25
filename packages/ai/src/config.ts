/**
 * Runtime configuration for the AI package. Everything has an explicit default and an
 * environment-variable override. No secret is ever logged; `apiKey` is read lazily and
 * never echoed.
 */

export interface AiConfig {
  /** Model id passed to the Anthropic Messages API. */
  anthropicModel: string;
  /** Effort for adaptive thinking on Claude 5-family models. */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** Upper bound on response tokens for a labeling call. */
  maxOutputTokens: number;
  /** Cost controls (owner decision 2026-10-25: $25 default per-job abort threshold). */
  jobBudgetUsd: number;
  maxFramesPerSegment: number;
  maxSegmentsPerJob: number;
  /** Request timeout in milliseconds (TypeScript SDK uses milliseconds). */
  requestTimeoutMs: number;
}

export const DEFAULT_AI_CONFIG: Readonly<AiConfig> = Object.freeze({
  // Verified vision-capable on 2026-10-25 at
  // https://platform.claude.com/docs/en/about-claude/models/overview ("All current models
  // support text and image input"). See docs/ai/MODEL_CANDIDATES.md for the comparison.
  anthropicModel: "claude-opus-5-5",
  effort: "medium",
  maxOutputTokens: 4096,
  jobBudgetUsd: 25,
  maxFramesPerSegment: 12,
  maxSegmentsPerJob: 200,
  requestTimeoutMs: 120_000,
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

const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

/** Build the config from `process.env` (or an injected env) on top of the defaults. */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const effortRaw = env.FOOTBALLOS_AI_EFFORT ?? DEFAULT_AI_CONFIG.effort;
  if (!EFFORTS.has(effortRaw)) {
    throw new Error(`FOOTBALLOS_AI_EFFORT must be one of low|medium|high|xhigh|max, got ${effortRaw}`);
  }
  return {
    anthropicModel: env.FOOTBALLOS_AI_MODEL?.trim() || DEFAULT_AI_CONFIG.anthropicModel,
    effort: effortRaw as AiConfig["effort"],
    maxOutputTokens: numberEnv("FOOTBALLOS_AI_MAX_OUTPUT_TOKENS", DEFAULT_AI_CONFIG.maxOutputTokens, env),
    jobBudgetUsd: numberEnv("FOOTBALLOS_AI_JOB_BUDGET_USD", DEFAULT_AI_CONFIG.jobBudgetUsd, env),
    maxFramesPerSegment: numberEnv("FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT", DEFAULT_AI_CONFIG.maxFramesPerSegment, env),
    maxSegmentsPerJob: numberEnv("FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB", DEFAULT_AI_CONFIG.maxSegmentsPerJob, env),
    requestTimeoutMs: numberEnv("FOOTBALLOS_AI_REQUEST_TIMEOUT_MS", DEFAULT_AI_CONFIG.requestTimeoutMs, env),
  };
}

/** Read the Anthropic key without ever placing it in a log line or error message. */
export function readAnthropicApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.ANTHROPIC_API_KEY;
  return key && key.trim() !== "" ? key : null;
}
