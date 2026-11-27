import { describe, expect, it } from "vitest";
import { ModelProvenanceSchema } from "@footballos/contracts";
import {
  DEFAULT_AI_CONFIG,
  LABEL_RESPONSE_JSON_SCHEMA,
  OllamaClient,
  OllamaVisionLabeler,
  ProviderUnavailableError,
  buildContextText,
  checkOllama,
  createVisionLabeler,
  loadPrompt,
  type FetchLike,
} from "../src/index.js";
import { chatResponse, fakeOllama, goodResponse, makeInput, refusedFetch } from "./helpers.js";

const HOST = "http://127.0.0.1:11434";

describe("OllamaVisionLabeler with a fake Ollama server", () => {
  it("asks /api/show once, then sends one /api/chat request: model, JSON-schema format, temperature 0, sized num_ctx, system prompt, frames as images in order", async () => {
    const input = makeInput();
    const server = fakeOllama({ chat: () => chatResponse(goodResponse(input.frames.map((f) => f.atSec))) });
    let tick = 0;
    const labeler = new OllamaVisionLabeler({ fetchImpl: server.fetch, now: () => new Date(1_700_000_000_000 + 1500 * tick++) });
    expect(labeler.isAvailable()).toBe(true);
    const out = await labeler.labelSegment(input);

    expect(server.requests.map((r) => [r.method, r.path])).toEqual([["POST", "/api/show"], ["POST", "/api/chat"]]);
    const body = server.requests[1]!.body as Record<string, any>;
    expect(body.model).toBe(DEFAULT_AI_CONFIG.model);
    expect(body.stream).toBe(false);
    expect(body.format).toEqual(LABEL_RESPONSE_JSON_SCHEMA);
    // 7 frames at ~1400 tokens each plus the text and the whole num_predict, rounded up to 2048.
    expect(body.options).toEqual({ temperature: 0, num_predict: DEFAULT_AI_CONFIG.maxOutputTokens, num_ctx: 16384 });
    // The fake model has no "thinking" capability, so no `think` field is sent (older models reject it).
    expect(body).not.toHaveProperty("think");
    expect(body.keep_alive).toBe(DEFAULT_AI_CONFIG.keepAlive);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: "system", content: loadPrompt("label-segment", 1).text });
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].images).toEqual(input.frames.map((f) => f.jpegBase64));
    expect(body.messages[1].content).toBe(buildContextText(input));
    expect(body.messages[1].content).toContain("Frame 1 of 7 — t=10.000s");
    expect(body.messages[1].content).toContain("Frame 7 of 7 — t=16.000s");
    expect(body.messages[1].content).toContain('<team_cues untrusted="true">\nwhite jerseys\n</team_cues>');
    expect(body.messages[1].content).toContain('- play_type: one of "run", "pass"');

    expect(out.labels.map((l) => [l.key, l.inferred.value, l.inferred.abstained])).toEqual([
      ["formation_family", "trips", false],
      ["play_type", "pass", false],
      ["situation_down", null, true],
    ]);
    expect(out.provenance).toMatchObject({
      provider: "ollama",
      model: "qwen3-vl:4b",
      promptId: "label-segment.v1",
      promptHash: loadPrompt("label-segment", 1).hash,
      inputTokens: 9000,
      outputTokens: 300,
      costUsd: 0,
      latencyMs: 1500,
      preprocessing: { samplingFps: 1, frameCount: 7, clipSec: 7, resolution: "1280x720" },
      inspected: { fromSec: 10, toSec: 16, frameTimestampsSec: [10, 11, 12, 13, 14, 15, 16] },
    });
    expect(ModelProvenanceSchema.safeParse(out.provenance).success).toBe(true);
  });

  it("honours config overrides for model, host, num_predict and keep_alive", async () => {
    const server = fakeOllama({ models: { "qwen3-vl:8b": ["vision"] }, chat: () => chatResponse(goodResponse([10, 11, 12, 13, 14, 15, 16]), { model: "qwen3-vl:8b" }) });
    const labeler = createVisionLabeler({ env: { OLLAMA_HOST: "gpu-box:11434/", FOOTBALLOS_AI_MODEL: "qwen3-vl:8b", FOOTBALLOS_AI_MAX_OUTPUT_TOKENS: "2048", FOOTBALLOS_AI_KEEP_ALIVE: "1h" }, fetchImpl: server.fetch });
    const out = await labeler.labelSegment(makeInput());
    const body = server.requests[1]!.body as Record<string, any>;
    expect(body.model).toBe("qwen3-vl:8b");
    expect(body.options.num_predict).toBe(2048);
    expect(body.keep_alive).toBe("1h");
    expect(out.provenance.model).toBe("qwen3-vl:8b");
  });

  it("turns hidden reasoning off for thinking-capable models (think: false), once per labeler, and caps num_ctx", async () => {
    const server = fakeOllama({ models: { "qwen3-vl:4b": ["completion", "vision", "tools", "thinking"] }, chat: () => chatResponse(goodResponse([10, 11, 12, 13, 14, 15, 16])) });
    const labeler = new OllamaVisionLabeler({ fetchImpl: server.fetch, config: { maxNumCtx: 8192 } });
    await labeler.labelSegment(makeInput());
    await labeler.labelSegment(makeInput());
    expect(server.requests.map((r) => r.path)).toEqual(["/api/show", "/api/chat", "/api/chat"]);
    const body = server.requests[1]!.body as Record<string, any>;
    expect(body.think).toBe(false);
    expect(body.options.num_ctx).toBe(8192);
  });

  it("maps done_reason=length to truncated_output (not retryable)", async () => {
    const server = fakeOllama({ chat: () => chatResponse('{"labels":[', { done_reason: "length" }) });
    await expect(new OllamaVisionLabeler({ fetchImpl: server.fetch }).labelSegment(makeInput())).rejects.toMatchObject({ code: "provider_unavailable", reason: "truncated_output", retryable: false });
  });

  it("maps non-JSON content to invalid_model_output (retryable) and schema violations through the validator", async () => {
    const notJson = fakeOllama({ chat: () => chatResponse("I cannot tell.") });
    await expect(new OllamaVisionLabeler({ fetchImpl: notJson.fetch }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "invalid_model_output", retryable: true });
    const foreignTimestamp = fakeOllama({ chat: () => chatResponse({ labels: [{ key: "play_type", value: "pass", abstained: false, rationale: "x", evidence_timestamps_sec: [99], uncertainty: "low" }] }) });
    const err = await new OllamaVisionLabeler({ fetchImpl: foreignTimestamp.fetch }).labelSegment(makeInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as ProviderUnavailableError).reason).toBe("invalid_model_output");
  });

  it("a headers/body timeout from Node's fetch or our own AbortSignal → network, retryable, says the model may still be working", async () => {
    const headersTimeout: FetchLike = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT", name: "HeadersTimeoutError" }) }); };
    const e1 = await new OllamaVisionLabeler({ fetchImpl: headersTimeout, config: { requestTimeoutMs: 300_000 } }).labelSegment(makeInput()).catch((e: unknown) => e);
    expect(e1).toMatchObject({ reason: "network", retryable: true });
    expect((e1 as Error).message).toContain("did not answer within 300 s");
    const aborted: FetchLike = async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); };
    const e2 = await new OllamaVisionLabeler({ fetchImpl: aborted }).labelSegment(makeInput()).catch((e: unknown) => e);
    expect(e2).toMatchObject({ reason: "network", retryable: true });
    const reset: FetchLike = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) }); };
    const e3 = await new OllamaVisionLabeler({ fetchImpl: reset }).labelSegment(makeInput()).catch((e: unknown) => e);
    expect(e3).toMatchObject({ reason: "network", retryable: true });
  });

  it("connection refused → unreachable, not retryable, names the host and `ollama serve`", async () => {
    const err = await new OllamaVisionLabeler({ fetchImpl: refusedFetch() }).labelSegment(makeInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(err).toMatchObject({ reason: "unreachable", retryable: false });
    expect((err as Error).message).toContain(HOST);
    expect((err as Error).message).toContain("ollama serve");
  });

  it("a model that is not pulled → model_missing with the pull command; a 5xx → server_error retryable", async () => {
    const missing = fakeOllama({ models: {} });
    const err = await new OllamaVisionLabeler({ fetchImpl: missing.fetch }).labelSegment(makeInput()).catch((e: unknown) => e);
    expect(err).toMatchObject({ reason: "model_missing", retryable: false, status: 404 });
    expect((err as Error).message).toContain("ollama pull qwen3-vl:4b");
    const broken = fakeOllama({ chat: () => new Response("boom", { status: 500 }) });
    await expect(new OllamaVisionLabeler({ fetchImpl: broken.fetch }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "server_error", retryable: true, status: 500 });
  });

  it("rejects malformed input before any request", async () => {
    const server = fakeOllama();
    const labeler = new OllamaVisionLabeler({ fetchImpl: server.fetch });
    await expect(labeler.labelSegment(makeInput({ frames: [] }))).rejects.toMatchObject({ reason: "input_rejected" });
    await expect(labeler.labelSegment(makeInput({ labelKeys: [] }))).rejects.toMatchObject({ reason: "input_rejected" });
    expect(server.requests).toHaveLength(0);
  });
});

describe("checkOllama", () => {
  const config = { ollamaHost: HOST, model: "qwen3-vl:4b", requestTimeoutMs: 1000 };

  it("reports ok with the server version when the model is pulled and sees", async () => {
    const server = fakeOllama({ version: "0.40.16" });
    expect(await checkOllama(config, server.fetch)).toEqual({ ok: true, host: HOST, version: "0.40.16", model: "qwen3-vl:4b" });
    expect(server.requests.map((r) => r.path)).toEqual(["/api/version", "/api/show"]);
    expect(server.requests[1]!.body).toEqual({ model: "qwen3-vl:4b" });
  });

  it("reports unreachable, model_missing and model_not_vision truthfully", async () => {
    expect(await checkOllama(config, refusedFetch())).toMatchObject({ ok: false, reason: "unreachable", message: expect.stringContaining("ollama serve") });
    expect(await checkOllama(config, fakeOllama({ models: {} }).fetch)).toMatchObject({ ok: false, reason: "model_missing", message: expect.stringContaining("ollama pull qwen3-vl:4b") });
    const textOnly = await checkOllama({ ...config, model: "llama3:latest" }, fakeOllama({ models: { "llama3:latest": ["completion"] } }).fetch);
    expect(textOnly).toMatchObject({ ok: false, reason: "model_not_vision", message: expect.stringContaining("llama3:latest") });
  });

  it("passes a model whose capabilities are not reported (older Ollama builds)", async () => {
    expect((await checkOllama(config, fakeOllama({ models: { "qwen3-vl:4b": null } }).fetch)).ok).toBe(true);
  });
});

describe("OllamaClient", () => {
  it("normalizes a trailing slash and reads version", async () => {
    const server = fakeOllama({ version: "9.9.9" });
    const client = new OllamaClient({ host: `${HOST}/`, fetchImpl: server.fetch });
    expect(client.host).toBe(HOST);
    expect(await client.version()).toBe("9.9.9");
  });
});
