import { z } from "zod";
import { LABEL_KEYS } from "../types.js";

/**
 * Response schema. Sent to the API as `output_config.format` (JSON schema) and used to
 * validate the returned JSON locally with zod. Only the keyword subset documented as
 * supported by structured outputs is used (no min/max, no minItems > 1,
 * additionalProperties false). Source:
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs (accessed 2026-10-25).
 */
export const labelEntrySchema = z.object({
  key: z.enum(LABEL_KEYS as unknown as [string, ...string[]]),
  value: z.string().nullable(),
  abstained: z.boolean(),
  rationale: z.string(),
  /** Frame timestamps (seconds) cited as evidence; must be a subset of what was shown. */
  evidence_timestamps_sec: z.array(z.number()),
  uncertainty: z.enum(["low", "medium", "high"]).nullable(),
});

export const labelResponseSchema = z.object({
  labels: z.array(labelEntrySchema),
});

export type LabelResponse = z.infer<typeof labelResponseSchema>;

/** JSON schema handed to the API. Written by hand so the exact wire shape is reviewable. */
export const LABEL_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string", enum: [...LABEL_KEYS] },
          value: {
            type: ["string", "null"],
            description: "The label value from the allowed vocabulary, or null when abstaining.",
          },
          abstained: {
            type: "boolean",
            description: "true when the frames do not show enough to decide; value must then be null.",
          },
          rationale: { type: "string", description: "One or two sentences on what was (or was not) visible." },
          evidence_timestamps_sec: {
            type: "array",
            items: { type: "number" },
            description: "Timestamps (seconds) of the shown frames that support the value. Only timestamps that were shown.",
          },
          uncertainty: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
        },
        required: ["key", "value", "abstained", "rationale", "evidence_timestamps_sec", "uncertainty"],
        additionalProperties: false,
      },
    },
  },
  required: ["labels"],
  additionalProperties: false,
};

/** Allowed values per key (CONTRACTS §6 comments). Free-text keys are listed as null. */
export const LABEL_VOCABULARY: Readonly<Record<string, readonly string[] | null>> = Object.freeze({
  unit: ["offense", "defense", "special_teams", "unknown"],
  play_type: ["run", "pass", "other", "unknown"],
  formation_family: null,
  alignment: null,
  personnel_estimate: null,
  situation_down: ["1", "2", "3", "4"],
  situation_distance: null,
  situation_field_position: null,
  hash: ["left", "middle", "right"],
  motion: ["yes", "no"],
  result_visible: ["yes", "no"],
  special_teams_type: ["kickoff", "punt", "fg_pat", "return", "other"],
});
