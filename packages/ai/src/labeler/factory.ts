import { loadAiConfig, readAnthropicApiKey, type AiConfig } from "../config.js";
import { JobBudget } from "../cost/budget.js";
import { AnthropicVisionLabeler } from "./anthropic.js";
import { NullLabeler } from "./null.js";
import { OpenAIVisionLabeler } from "./openai.js";
import type { VisionLabeler } from "./types.js";

export type ProviderChoice = "anthropic" | "openai" | "none";

/**
 * Provider selection per team is configuration (D-004). Without a key for the chosen
 * provider the returned labeler still exists and reports `provider_unavailable` honestly.
 */
export function createVisionLabeler(
  choice: ProviderChoice,
  opts: { env?: NodeJS.ProcessEnv; config?: Partial<AiConfig>; budget?: JobBudget } = {},
): VisionLabeler {
  const env = opts.env ?? process.env;
  switch (choice) {
    case "anthropic": {
      const config = { ...loadAiConfig(env), ...opts.config };
      return new AnthropicVisionLabeler({ config, apiKey: readAnthropicApiKey(env), budget: opts.budget });
    }
    case "openai":
      return new OpenAIVisionLabeler({ env });
    case "none":
      return new NullLabeler();
  }
}
