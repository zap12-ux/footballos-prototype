import type { FetchLike, LabelSegmentInput, LabelSegmentOutput, VisionLabeler } from "../src/index.js";
import { ProviderUnavailableError } from "../src/index.js";

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

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

/** Shape of one Ollama `/api/chat` response as the fake server returns it. */
export function chatResponse(json: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "qwen3-vl:4b",
    created_at: "2026-11-27T12:00:00.000Z",
    message: { role: "assistant", content: typeof json === "string" ? json : JSON.stringify(json) },
    done: true,
    done_reason: "stop",
    total_duration: 4_200_000_000,
    prompt_eval_count: 9000,
    eval_count: 300,
    ...overrides,
  };
}

export interface FakeOllamaOptions {
  version?: string;
  /** Models the fake server "has", with their capabilities. */
  models?: Record<string, string[] | null>;
  /** Response for `/api/chat`; a thrown value propagates as the fetch failure. */
  chat?: (body: Record<string, unknown>) => Record<string, unknown> | Response;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake `fetch` that behaves like the three Ollama endpoints the adapters use and records every request. */
export function fakeOllama(options: FakeOllamaOptions = {}): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const models = options.models ?? { "qwen3-vl:4b": ["completion", "vision"] };
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname === "/api/version") return json(200, { version: options.version ?? "0.40.16" });
    if (url.pathname === "/api/show") {
      const model = String(body?.model);
      if (!(model in models)) return json(404, { error: `model '${model}' not found` });
      const caps = models[model];
      return json(200, caps === null ? { details: {} } : { details: {}, capabilities: caps });
    }
    if (url.pathname === "/api/chat") {
      const model = String(body?.model);
      if (!(model in models)) return json(404, { error: `model '${model}' not found` });
      const out = options.chat ? options.chat(body ?? {}) : chatResponse({});
      return out instanceof Response ? out : json(200, out);
    }
    return json(404, { error: "no such route" });
  };
  return { fetch, requests };
}

/** A `fetch` that fails the way Node's does when nothing listens on the port. */
export function refusedFetch(): FetchLike {
  return async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { code: "ECONNREFUSED" }) });
  };
}

export interface RawEntry { key: string; value: string | null; abstained: boolean; rationale: string; evidence_timestamps_sec: number[]; uncertainty: string | null }

export function goodResponse(timestamps: number[]): { labels: RawEntry[] } {
  return {
    labels: [
      { key: "formation_family", value: "trips", abstained: false, rationale: "Three receivers to the right at the snap.", evidence_timestamps_sec: [timestamps[0]!], uncertainty: "low" },
      { key: "play_type", value: "pass", abstained: false, rationale: "Quarterback drops and throws across frames.", evidence_timestamps_sec: [timestamps[1]!, timestamps[3]!], uncertainty: "medium" },
      { key: "situation_down", value: null, abstained: true, rationale: "No down marker or graphic visible.", evidence_timestamps_sec: [], uncertainty: null },
    ],
  };
}

/** A labeler that always reports the model server as down, for handler tests. */
export class DownLabeler implements VisionLabeler {
  readonly provider = "ollama" as const;
  constructor(private readonly available = true) {}
  isAvailable(): boolean {
    return this.available;
  }
  async labelSegment(_input: LabelSegmentInput): Promise<LabelSegmentOutput> {
    throw new ProviderUnavailableError({ provider: "ollama", reason: "unreachable", retryable: false, message: "Ollama is not reachable at http://127.0.0.1:11434 (OLLAMA_HOST). Start it with `ollama serve` and try again" });
  }
}
