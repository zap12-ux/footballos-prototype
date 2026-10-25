import { describe, expect, it } from "vitest";
import { NullLabeler, OpenAIVisionLabeler, createVisionLabeler } from "../src/index.js";
import { makeInput } from "./helpers.js";

describe("OpenAIVisionLabeler stub and NullLabeler", () => {
  it("OpenAI stub reports no_api_key without a key and not_implemented with one", async () => {
    const noKey = new OpenAIVisionLabeler({ env: {} });
    expect(noKey.isAvailable()).toBe(false);
    await expect(noKey.labelSegment(makeInput())).rejects.toMatchObject({ provider: "openai", reason: "no_api_key", retryable: false });
    const withKey = new OpenAIVisionLabeler({ apiKey: "test-key-not-used" });
    await expect(withKey.labelSegment(makeInput())).rejects.toMatchObject({ provider: "openai", reason: "not_implemented" });
  });

  it("NullLabeler always reports provider_unavailable", async () => {
    const n = new NullLabeler();
    expect(n.isAvailable()).toBe(false);
    await expect(n.labelSegment(makeInput())).rejects.toMatchObject({ provider: "none", code: "provider_unavailable" });
  });

  it("factory honours the provider choice and reads config from env", () => {
    const a = createVisionLabeler("anthropic", { env: { FOOTBALLOS_AI_MODEL: "claude-sonnet-5-5" } });
    expect(a.provider).toBe("anthropic");
    expect(a.isAvailable()).toBe(false);
    expect(createVisionLabeler("openai", { env: {} }).provider).toBe("openai");
    expect(createVisionLabeler("none").provider).toBe("none");
  });
});
