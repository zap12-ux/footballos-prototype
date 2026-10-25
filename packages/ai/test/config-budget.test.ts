import { describe, expect, it } from "vitest";
import { DEFAULT_AI_CONFIG, JobBudget, computeCostUsd, estimateCallCostUsd, estimateImageTokens, loadAiConfig, readAnthropicApiKey } from "../src/index.js";

describe("config", () => {
  it("defaults to the owner's $25 per-job budget and the documented model", () => {
    const c = loadAiConfig({});
    expect(c.jobBudgetUsd).toBe(25);
    expect(c.anthropicModel).toBe("claude-opus-5-5");
    expect(c).toEqual(DEFAULT_AI_CONFIG);
  });
  it("reads env overrides and rejects nonsense", () => {
    const c = loadAiConfig({ FOOTBALLOS_AI_JOB_BUDGET_USD: "5", FOOTBALLOS_AI_MODEL: "claude-haiku-5-5", FOOTBALLOS_AI_EFFORT: "low" });
    expect(c).toMatchObject({ jobBudgetUsd: 5, anthropicModel: "claude-haiku-5-5", effort: "low" });
    expect(() => loadAiConfig({ FOOTBALLOS_AI_JOB_BUDGET_USD: "-1" })).toThrow();
    expect(() => loadAiConfig({ FOOTBALLOS_AI_EFFORT: "turbo" })).toThrow();
    expect(readAnthropicApiKey({})).toBeNull();
    expect(readAnthropicApiKey({ ANTHROPIC_API_KEY: "  " })).toBeNull();
  });
});

describe("pricing", () => {
  it("computes cost from usage with cache categories and returns null for unknown models", () => {
    expect(computeCostUsd("claude-sonnet-5-5", { inputTokens: 1_000_000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 })).toBe(2);
    expect(computeCostUsd("claude-opus-5-5", { inputTokens: 0, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(25.2);
    expect(computeCostUsd("some-future-model", { inputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 })).toBeNull();
  });
  it("estimates image tokens with the 28-px patch rule and the high-resolution cap", () => {
    expect(estimateImageTokens(1280, 720)).toBe(46 * 26);
    expect(estimateImageTokens(3840, 2160)).toBe(4784);
    expect(estimateImageTokens(null, null)).toBe(4784);
  });
  it("pre-call estimate is conservative (full output budget) and null for unpriced models", () => {
    const est = estimateCallCostUsd({ model: "claude-haiku-5-5", frames: [{ width: 1280, height: 720 }], promptText: "x".repeat(350), maxOutputTokens: 1000 });
    // (1196 + 100) * 0.10/M + 1000 * 0.50/M
    expect(est).toBeCloseTo((1296 * 0.1 + 1000 * 0.5) / 1e6, 10);
    expect(estimateCallCostUsd({ model: "nope", frames: [], promptText: "", maxOutputTokens: 1 })).toBeNull();
  });
});

describe("JobBudget", () => {
  it("reserves, settles with the real cost, and refuses when the limit would be exceeded", () => {
    const b = new JobBudget(1);
    const r = b.reserve(0.6);
    expect(b.remainingUsd).toBeCloseTo(0.4);
    expect(() => b.reserve(0.5)).toThrow(/budget_exceeded|budget/);
    r.settle(0.1);
    expect(b.spentUsd).toBeCloseTo(0.1);
    expect(b.reservedUsd).toBe(0);
    expect(b.callCount).toBe(1);
    const r2 = b.reserve(0.5);
    r2.release();
    expect(b.reservedUsd).toBe(0);
    expect(() => b.reserve(null)).toThrow();
  });
});
