import { ProviderUnavailableError } from "../errors.js";
import type { Provider } from "../types.js";
import type { LabelSegmentInput } from "./types.js";

/** Reject malformed inputs before any money is spent. */
export function assertLabelInput(input: LabelSegmentInput, provider: Provider, maxFrames: number): void {
  const fail = (message: string) =>
    new ProviderUnavailableError({ provider, reason: "input_rejected", retryable: false, message });
  if (input.frames.length === 0) throw fail("no frames supplied");
  if (input.frames.length > maxFrames) throw fail(`${input.frames.length} frames exceed the per-segment cap of ${maxFrames}`);
  if (input.labelKeys.length === 0) throw fail("no label keys requested");
  if (new Set(input.labelKeys).size !== input.labelKeys.length) throw fail("duplicate label keys requested");
  for (let i = 0; i < input.frames.length; i++) {
    const f = input.frames[i]!;
    if (!Number.isFinite(f.atSec) || f.atSec < 0) throw fail(`frame ${i} has an invalid timestamp`);
    if (i > 0 && f.atSec <= input.frames[i - 1]!.atSec) throw fail(`frames must be strictly ascending by atSec (frame ${i})`);
    if (typeof f.jpegBase64 !== "string" || f.jpegBase64.length === 0) throw fail(`frame ${i} has no JPEG data`);
    if (f.jpegBase64.startsWith("data:")) throw fail(`frame ${i} must be raw base64 without a data: prefix`);
  }
  if (!(input.segment.endSec > input.segment.startSec)) throw fail("segment endSec must be greater than startSec");
}
