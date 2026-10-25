/**
 * Price table used to compute `ModelProvenance.costUsd` from real response usage.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/pricing (accessed 2026-10-25).
 * Prices are USD per million tokens. Unknown models yield `null` cost rather than a guess.
 * Update this table together with docs/ai/MODEL_CANDIDATES.md.
 */

export interface ModelPrice {
  inputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheReadPerMTok: number;
  outputPerMTok: number;
  sourceUrl: string;
  accessedOn: string;
}

const PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing";
const ACCESSED = "2026-10-25";

export const ANTHROPIC_PRICES: Readonly<Record<string, ModelPrice>> = Object.freeze({
  "claude-fable-5-1": { inputPerMTok: 10, cacheWrite5mPerMTok: 12.5, cacheReadPerMTok: 0.25, outputPerMTok: 50, sourceUrl: PRICING_URL, accessedOn: ACCESSED },
  "claude-opus-5-5": { inputPerMTok: 4, cacheWrite5mPerMTok: 5, cacheReadPerMTok: 0.2, outputPerMTok: 20, sourceUrl: PRICING_URL, accessedOn: ACCESSED },
  "claude-sonnet-5-5": { inputPerMTok: 2, cacheWrite5mPerMTok: 2.5, cacheReadPerMTok: 0.1, outputPerMTok: 10, sourceUrl: PRICING_URL, accessedOn: ACCESSED },
  // Haiku 5.5 price below applies to prompts up to 100,000 tokens; a labeling request with
  // at most 12 frames stays far under that threshold.
  "claude-haiku-5-5": { inputPerMTok: 0.1, cacheWrite5mPerMTok: 0.125, cacheReadPerMTok: 0.01, outputPerMTok: 0.5, sourceUrl: PRICING_URL, accessedOn: ACCESSED },
});

export interface UsageBreakdown {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

/** Cost in USD for a response, or null when the model is not in the table. */
export function computeCostUsd(model: string, usage: UsageBreakdown): number | null {
  const price = ANTHROPIC_PRICES[model];
  if (!price) return null;
  const usd =
    (usage.inputTokens * price.inputPerMTok +
      usage.cacheCreationInputTokens * price.cacheWrite5mPerMTok +
      usage.cacheReadInputTokens * price.cacheReadPerMTok +
      usage.outputTokens * price.outputPerMTok) /
    1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Visual-token estimate for one image. Source: vision docs "Resolution and token cost"
 * (https://platform.claude.com/docs/en/build-with-claude/vision, accessed 2026-10-25):
 * ⌈width/28⌉ × ⌈height/28⌉ visual tokens, capped by the model tier (4,784 for Claude 4.7
 * and later; 1,568 for older models). Unknown dimensions assume the cap (conservative).
 */
export const HIGH_RES_MAX_VISUAL_TOKENS = 4784;

export function estimateImageTokens(width: number | null, height: number | null): number {
  if (width === null || height === null || width <= 0 || height <= 0) return HIGH_RES_MAX_VISUAL_TOKENS;
  return Math.min(HIGH_RES_MAX_VISUAL_TOKENS, Math.ceil(width / 28) * Math.ceil(height / 28));
}

/** Rough text-token estimate (about 3.5 characters per token on the current tokenizer; conservative). */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Pre-call upper-bound estimate: every frame at its (or the capped) token count, the prompt
 * text, and the full `maxOutputTokens` as output. Null when the model is not priced.
 */
export function estimateCallCostUsd(opts: {
  model: string;
  frames: { width: number | null; height: number | null }[];
  promptText: string;
  maxOutputTokens: number;
}): number | null {
  const price = ANTHROPIC_PRICES[opts.model];
  if (!price) return null;
  const imageTokens = opts.frames.reduce((sum, f) => sum + estimateImageTokens(f.width, f.height), 0);
  const inputTokens = imageTokens + estimateTextTokens(opts.promptText);
  return (inputTokens * price.inputPerMTok + opts.maxOutputTokens * price.outputPerMTok) / 1_000_000;
}
