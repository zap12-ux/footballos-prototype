import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { AnthropicVisionLabeler, JobBudget, ProviderUnavailableError, isProviderUnavailable, loadPrompt, mapAnthropicError } from "../src/index.js";
import { FakeTransport, goodResponse, makeInput, makeMessage } from "./helpers.js";

const ts = [10, 11, 12, 13, 14, 15, 16];

describe("AnthropicVisionLabeler with a fake transport", () => {
  it("sends ordered frames with timestamps, the versioned prompt and a JSON schema, and returns labels + provenance", async () => {
    const transport = new FakeTransport(() => makeMessage(goodResponse(ts)));
    const labeler = new AnthropicVisionLabeler({ transport, now: (() => { let n = 0; return () => new Date(1_700_000_000_000 + 250 * n++); })() });
    expect(labeler.isAvailable()).toBe(true);

    const out = await labeler.labelSegment(makeInput());

    // Request shape
    const params = transport.calls[0]!;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params.output_config?.effort).toBe("medium");
    const content = params.messages[0]!.content as Anthropic.ContentBlockParam[];
    const images = content.filter((b) => b.type === "image");
    expect(images).toHaveLength(7);
    const texts = content.filter((b): b is Anthropic.TextBlockParam => b.type === "text").map((b) => b.text);
    expect(texts[0]).toContain("t=10.000s");
    expect(texts[6]).toContain("t=16.000s");
    expect(texts.at(-1)).toContain("<team_cues untrusted=\"true\">");
    expect(texts.at(-1)).toContain("white jerseys");
    const system = params.system as Anthropic.TextBlockParam[];
    expect(system[0]!.text).toBe(loadPrompt("label-segment", 1).text);

    // Labels
    expect(out.labels.map((l) => l.key)).toEqual(["formation_family", "play_type", "situation_down"]);
    expect(out.labels[0]!.inferred).toMatchObject({ value: "trips", abstained: false, uncertainty: "low" });
    expect(out.labels[0]!.inferred.evidence).toEqual([{ assetId: "asset_1", atSec: 10, toSec: null, frameIndex: 0, note: null }]);
    expect(out.labels[1]!.inferred.evidence.map((e) => e.frameIndex)).toEqual([1, 3]);
    expect(out.labels[2]!.inferred).toMatchObject({ value: null, abstained: true, uncertainty: null, evidence: [] });

    // Provenance from real usage fields
    const p = out.provenance;
    expect(p.provider).toBe("anthropic");
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.promptId).toBe("label-segment.v1");
    expect(p.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.promptHash).toBe(loadPrompt("label-segment", 1).hash);
    expect(p.inspected).toEqual({ fromSec: 10, toSec: 16, frameTimestampsSec: ts });
    expect(p.preprocessing).toEqual({ samplingFps: 1, frameCount: 7, clipSec: 7, resolution: "1280x720" });
    expect(p.inputTokens).toBe(9500);
    expect(p.outputTokens).toBe(300);
    // 9000*4 + 500*5 + 300*20 per MTok = 0.036 + 0.0025 + 0.006
    expect(p.costUsd).toBeCloseTo(0.0445, 6);
    expect(p.latencyMs).toBe(250);
    expect(labeler.jobBudget.spentUsd).toBeCloseTo(0.0445, 6);
    expect(labeler.jobBudget.callCount).toBe(1);
  });

  it("rejects a response citing a timestamp that was not inspected", async () => {
    const bad = goodResponse(ts);
    bad.labels[0]!.evidence_timestamps_sec = [10.5];
    const labeler = new AnthropicVisionLabeler({ transport: new FakeTransport(() => makeMessage(bad)) });
    await expect(labeler.labelSegment(makeInput())).rejects.toMatchObject({ code: "provider_unavailable", reason: "invalid_model_output", retryable: true });
  });

  it("rejects a non-null value with no evidence and an abstention that carries a value", async () => {
    const noEvidence = goodResponse(ts);
    noEvidence.labels[0]!.evidence_timestamps_sec = [];
    await expect(new AnthropicVisionLabeler({ transport: new FakeTransport(() => makeMessage(noEvidence)) }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "invalid_model_output" });

    const abstainedWithValue = goodResponse(ts);
    abstainedWithValue.labels[2] = { ...abstainedWithValue.labels[2]!, value: "3", abstained: true };
    await expect(new AnthropicVisionLabeler({ transport: new FakeTransport(() => makeMessage(abstainedWithValue)) }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "invalid_model_output" });
  });

  it("rejects keys that were not requested and values outside the vocabulary", async () => {
    const extra = goodResponse(ts);
    extra.labels.push({ key: "motion", value: "yes", abstained: false, rationale: "x", evidence_timestamps_sec: [10], uncertainty: "low" });
    await expect(new AnthropicVisionLabeler({ transport: new FakeTransport(() => makeMessage(extra)) }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "invalid_model_output" });

    const badVocab = goodResponse(ts);
    badVocab.labels[1]!.value = "screen";
    await expect(new AnthropicVisionLabeler({ transport: new FakeTransport(() => makeMessage(badVocab)) }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "invalid_model_output" });
  });

  it("records an omitted requested key as an explicit abstention", async () => {
    const partial = goodResponse(ts);
    partial.labels.pop(); // drop situation_down
    const out = await new AnthropicVisionLabeler({ transport: new FakeTransport(() => makeMessage(partial)) }).labelSegment(makeInput());
    expect(out.labels[2]).toMatchObject({ key: "situation_down", inferred: { value: null, abstained: true } });
  });

  it("maps refusal, truncation and non-JSON text to provider_unavailable without a canned result", async () => {
    const refusal = makeMessage("", { stop_reason: "refusal", stop_details: { type: "refusal", category: "general_harms", explanation: null } as never });
    await expect(new AnthropicVisionLabeler({ transport: new FakeTransport(() => refusal) }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "refusal", retryable: false });

    const truncated = makeMessage('{"labels":[', { stop_reason: "max_tokens" });
    await expect(new AnthropicVisionLabeler({ transport: new FakeTransport(() => truncated) }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "truncated_output" });

    const notJson = makeMessage("I cannot tell.");
    await expect(new AnthropicVisionLabeler({ transport: new FakeTransport(() => notJson) }).labelSegment(makeInput())).rejects.toMatchObject({ reason: "invalid_model_output", retryable: true });
  });

  it("maps SDK errors to retryable / non-retryable provider_unavailable", () => {
    const mk = (Cls: new (...a: never[]) => Error, status: number) =>
      (Cls as unknown as new (s: number, e: unknown, m: string, h: Headers) => Error)(status, { message: "x" }, "x", new Headers());
    expect(mapAnthropicError(mk(Anthropic.AuthenticationError as never, 401))).toMatchObject({ reason: "auth", retryable: false, status: 401 });
    expect(mapAnthropicError(mk(Anthropic.RateLimitError as never, 429))).toMatchObject({ reason: "rate_limited", retryable: true });
    expect(mapAnthropicError(mk(Anthropic.BadRequestError as never, 400))).toMatchObject({ reason: "bad_request", retryable: false });
    expect(mapAnthropicError(mk(Anthropic.InternalServerError as never, 503))).toMatchObject({ reason: "server_error", retryable: true });
    expect(mapAnthropicError(new Anthropic.APIConnectionError({ message: "down" }))).toMatchObject({ reason: "network", retryable: true });
    expect(mapAnthropicError(new Error("boom"))).toMatchObject({ reason: "unknown", retryable: false });
  });

  it("releases the budget reservation when the transport throws", async () => {
    const budget = new JobBudget(25);
    const labeler = new AnthropicVisionLabeler({ budget, transport: new FakeTransport(() => { throw new Anthropic.APIConnectionError({ message: "down" }); }) });
    await expect(labeler.labelSegment(makeInput())).rejects.toMatchObject({ reason: "network" });
    expect(budget.reservedUsd).toBe(0);
    expect(budget.spentUsd).toBe(0);
  });

  it("aborts before calling when the per-job budget would be exceeded", async () => {
    const transport = new FakeTransport(() => makeMessage(goodResponse(ts)));
    const labeler = new AnthropicVisionLabeler({ transport, budget: new JobBudget(0.01) });
    await expect(labeler.labelSegment(makeInput())).rejects.toMatchObject({ reason: "budget_exceeded", retryable: false });
    expect(transport.calls).toHaveLength(0);
  });

  it("reports no_api_key truthfully without a key or transport and never calls out", async () => {
    const labeler = new AnthropicVisionLabeler({ env: {} });
    expect(labeler.isAvailable()).toBe(false);
    try {
      await labeler.labelSegment(makeInput());
      throw new Error("should have thrown");
    } catch (err) {
      expect(isProviderUnavailable(err)).toBe(true);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
      expect((err as ProviderUnavailableError).reason).toBe("no_api_key");
      expect((err as ProviderUnavailableError).toJobError()).toEqual({ code: "provider_unavailable", message: expect.stringContaining("no_api_key") });
    }
  });

  it("rejects malformed input (unordered frames, too many frames) before spending", async () => {
    const transport = new FakeTransport(() => makeMessage(goodResponse(ts)));
    const labeler = new AnthropicVisionLabeler({ transport, config: { maxFramesPerSegment: 3 } });
    await expect(labeler.labelSegment(makeInput())).rejects.toMatchObject({ reason: "input_rejected" });
    const unordered = makeInput();
    unordered.frames = [unordered.frames[1]!, unordered.frames[0]!];
    await expect(labeler.labelSegment(unordered)).rejects.toMatchObject({ reason: "input_rejected" });
    expect(transport.calls).toHaveLength(0);
  });
});
