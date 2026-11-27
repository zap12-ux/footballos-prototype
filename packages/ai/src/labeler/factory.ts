import { loadAiConfig, type AiConfig } from "../config.js";
import type { FetchLike } from "../ollama/client.js";
import { OllamaPageLabeler } from "../playbook/ollama-page-labeler.js";
import type { PageLabeler } from "../playbook/types.js";
import { OllamaVisionLabeler } from "./ollama.js";
import type { VisionLabeler } from "./types.js";

export interface CreateLabelerOptions {
  /** Environment to read `OLLAMA_HOST` / `FOOTBALLOS_AI_*` from (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Overrides applied on top of the environment-derived config. */
  config?: Partial<AiConfig>;
  /** Injected for tests. */
  fetchImpl?: FetchLike;
}

/**
 * The one vision adapter: a local Ollama server (DECISIONS D-004, amended 2026-11-27). Whether
 * the server is up and the model pulled is checked with `checkOllama` before a job does work.
 */
export function createVisionLabeler(opts: CreateLabelerOptions = {}): VisionLabeler {
  const config = { ...loadAiConfig(opts.env ?? process.env), ...opts.config };
  return new OllamaVisionLabeler({ config, fetchImpl: opts.fetchImpl });
}

/** The document counterpart for playbook pages, over the same server and model. */
export function createPageLabeler(opts: CreateLabelerOptions = {}): PageLabeler {
  const config = { ...loadAiConfig(opts.env ?? process.env), ...opts.config };
  return new OllamaPageLabeler({ config, fetchImpl: opts.fetchImpl });
}
