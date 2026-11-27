import { describe, expect, it } from "vitest";
import { DEFAULT_AI_CONFIG, DEFAULT_OLLAMA_HOST, loadAiConfig, normalizeOllamaHost } from "../src/index.js";

describe("config", () => {
  it("defaults to the local Ollama server and the documented 4B vision model", () => {
    const c = loadAiConfig({});
    expect(c.ollamaHost).toBe("http://127.0.0.1:11434");
    expect(c.model).toBe("qwen3-vl:4b");
    expect(c.requestTimeoutMs).toBe(300_000);
    expect(c.keepAlive).toBe("10m");
    expect(c).toEqual(DEFAULT_AI_CONFIG);
  });

  it("reads env overrides and rejects nonsense", () => {
    const c = loadAiConfig({
      OLLAMA_HOST: "gpu-box.local:11434/",
      FOOTBALLOS_AI_MODEL: "qwen3-vl:8b",
      FOOTBALLOS_AI_MAX_OUTPUT_TOKENS: "2048",
      FOOTBALLOS_AI_MAX_FRAMES_PER_SEGMENT: "8",
      FOOTBALLOS_AI_MAX_SEGMENTS_PER_JOB: "50",
      FOOTBALLOS_AI_REQUEST_TIMEOUT_MS: "60000",
      FOOTBALLOS_AI_KEEP_ALIVE: "1h",
    });
    expect(c).toEqual({ ollamaHost: "http://gpu-box.local:11434", model: "qwen3-vl:8b", maxOutputTokens: 2048, maxFramesPerSegment: 8, maxSegmentsPerJob: 50, requestTimeoutMs: 60000, maxNumCtx: 32_768, keepAlive: "1h" });
    expect(() => loadAiConfig({ FOOTBALLOS_AI_MAX_OUTPUT_TOKENS: "-1" })).toThrow(/FOOTBALLOS_AI_MAX_OUTPUT_TOKENS/);
    expect(() => loadAiConfig({ FOOTBALLOS_AI_REQUEST_TIMEOUT_MS: "soon" })).toThrow();
    expect(() => loadAiConfig({ OLLAMA_HOST: "ftp://nope" })).toThrow(/http or https/);
    expect(() => loadAiConfig({ OLLAMA_HOST: "http://[bad" })).toThrow(/not a valid URL/);
  });

  it("normalizes OLLAMA_HOST like the Ollama CLI", () => {
    expect(normalizeOllamaHost(undefined)).toBe(DEFAULT_OLLAMA_HOST);
    expect(normalizeOllamaHost("  ")).toBe(DEFAULT_OLLAMA_HOST);
    expect(normalizeOllamaHost("127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
    expect(normalizeOllamaHost("https://ollama.example.org/")).toBe("https://ollama.example.org");
    expect(normalizeOllamaHost("http://host:11434/ollama/")).toBe("http://host:11434/ollama");
  });
});
