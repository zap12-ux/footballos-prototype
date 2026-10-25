import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicTransport, LabelSegmentInput } from "../src/index.js";

/** A 1x1 JPEG is not needed; the adapter never decodes frames. Any base64 string will do. */
export const FAKE_JPEG = Buffer.from("not-really-a-jpeg").toString("base64");

export function makeInput(overrides: Partial<LabelSegmentInput> = {}): LabelSegmentInput {
  return {
    segment: { id: "seg_1", assetId: "asset_1", gameId: "game_1", startSec: 10, endSec: 17 },
    frames: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ atSec: 10 + i, jpegBase64: FAKE_JPEG, width: 1280, height: 720 })),
    context: { analyzedTeam: "opponent", analyzedUnit: "offense", perspective: "endzone", teamCues: "white jerseys" },
    labelKeys: ["formation_family", "play_type", "situation_down"],
    samplingFps: 1,
    resolution: "1280x720",
    ...overrides,
  };
}

export function makeMessage(json: unknown, overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: typeof json === "string" ? json : JSON.stringify(json), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 9000,
      output_tokens: 300,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      iterations: null,
      speed: null,
      output_tokens_details: null,
    } as unknown as Anthropic.Usage,
    ...overrides,
  } as Anthropic.Message;
}

export class FakeTransport implements AnthropicTransport {
  calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  constructor(private readonly respond: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> | Anthropic.Message) {}
  async createMessage(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    this.calls.push(params);
    return this.respond(params);
  }
}

export function goodResponse(timestamps: number[]) {
  return {
    labels: [
      { key: "formation_family", value: "trips", abstained: false, rationale: "Three receivers to the right at the snap.", evidence_timestamps_sec: [timestamps[0]], uncertainty: "low" },
      { key: "play_type", value: "pass", abstained: false, rationale: "Quarterback drops and throws across frames.", evidence_timestamps_sec: [timestamps[1], timestamps[3]], uncertainty: "medium" },
      { key: "situation_down", value: null, abstained: true, rationale: "No down marker or graphic visible.", evidence_timestamps_sec: [], uncertainty: null },
    ],
  };
}
