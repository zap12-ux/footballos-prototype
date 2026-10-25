import { z } from 'zod';
import { CostUsdSchema, IdSchema, SecondsSchema, TimestampSchema, TokenCountSchema, VersionSchema } from './common.js';

// §6 Labels, corrections, provenance ------------------------------------------------------

export const LabelKeySchema = z.enum([
  'unit',
  'play_type',
  'formation_family',
  'alignment',
  'personnel_estimate',
  'situation_down',
  'situation_distance',
  'situation_field_position',
  'hash',
  'motion',
  'result_visible',
  'special_teams_type',
]);
export type LabelKey = z.infer<typeof LabelKeySchema>;

/** Keys that may never be inferred from nothing: only from visible evidence or a coach. */
export const EVIDENCE_ONLY_LABEL_KEYS: readonly LabelKey[] = [
  'situation_down',
  'situation_distance',
  'situation_field_position',
];

export const EvidenceRefSchema = z.object({
  assetId: IdSchema,
  atSec: SecondsSchema,
  toSec: SecondsSchema.nullable(),
  frameIndex: z.number().int().nonnegative().nullable(),
  note: z.string().max(1000).nullable(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const UncertaintySchema = z.enum(['low', 'medium', 'high']);
export type Uncertainty = z.infer<typeof UncertaintySchema>;

export const InferredLabelSchema = z
  .object({
    value: z.string().nullable(),
    abstained: z.boolean(),
    rationale: z.string(),
    evidence: z.array(EvidenceRefSchema),
    uncertainty: UncertaintySchema.nullable(),
  })
  .refine((v) => !v.abstained || v.value === null, { message: 'an abstention carries value: null', path: ['value'] });
export type InferredLabel = z.infer<typeof InferredLabelSchema>;

export const AcceptedStatusSchema = z.enum(['inferred', 'accepted', 'corrected', 'unknown', 'rejected']);
export type AcceptedStatus = z.infer<typeof AcceptedStatusSchema>;

export const AcceptedLabelSchema = z.object({
  value: z.string().nullable(),
  status: AcceptedStatusSchema,
  byUserId: IdSchema.nullable(),
  at: TimestampSchema.nullable(),
});
export type AcceptedLabel = z.infer<typeof AcceptedLabelSchema>;

export const LabelSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  segmentId: IdSchema,
  key: LabelKeySchema,
  inferred: InferredLabelSchema.nullable(),
  accepted: AcceptedLabelSchema,
  provenanceId: IdSchema.nullable(),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Label = z.infer<typeof LabelSchema>;

export const LabelRevisionSchema = z.object({
  id: IdSchema,
  labelId: IdSchema,
  previousValue: z.string().nullable(),
  newValue: z.string().nullable(),
  previousStatus: AcceptedStatusSchema,
  newStatus: AcceptedStatusSchema,
  byUserId: IdSchema,
  at: TimestampSchema,
  reason: z.string().max(1000).nullable(),
});
export type LabelRevision = z.infer<typeof LabelRevisionSchema>;

export const LabelCorrectionRequestSchema = z.object({
  expectedVersion: VersionSchema,
  value: z.string().nullable(),
  status: z.enum(['accepted', 'corrected', 'unknown', 'rejected']),
  reason: z.string().max(1000).nullable().default(null),
});
export type LabelCorrectionRequest = z.infer<typeof LabelCorrectionRequestSchema>;

export const ModelProviderSchema = z.enum(['anthropic', 'openai', 'open_source', 'none']);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const ModelProvenanceSchema = z.object({
  id: IdSchema,
  provider: ModelProviderSchema,
  model: z.string(),
  modelRevision: z.string().nullable(),
  promptId: z.string().min(1),
  promptHash: z.string().min(1),
  preprocessing: z.object({
    samplingFps: z.number().positive().nullable(),
    frameCount: z.number().int().nonnegative(),
    clipSec: SecondsSchema.nullable(),
    resolution: z.string(),
  }),
  /** Exactly what the model saw. */
  inspected: z.object({
    fromSec: SecondsSchema,
    toSec: SecondsSchema,
    frameTimestampsSec: z.array(SecondsSchema),
  }),
  analysisVersion: z.string().min(1),
  inputTokens: TokenCountSchema,
  outputTokens: TokenCountSchema,
  costUsd: CostUsdSchema,
  latencyMs: z.number().int().nonnegative(),
  requestedAt: TimestampSchema,
  completedAt: TimestampSchema,
});
export type ModelProvenance = z.infer<typeof ModelProvenanceSchema>;

// §14.5 Inference, corrections, bulk accept (v0.3) --------------------------------------

export const InferRequestSchema = z.object({
  segmentIds: z.array(IdSchema).min(1).max(2000).optional(),
  labelKeys: z.array(LabelKeySchema).min(1).optional(),
});
export type InferRequest = z.infer<typeof InferRequestSchema>;

/** `PATCH /labels/:labelId` body per CONTRACTS §14.5 (coach correction). */
export const PatchLabelRequestSchema = z.object({
  accepted: z.object({
    value: z.string().max(200).nullable(),
    status: z.enum(['accepted', 'corrected', 'unknown', 'rejected']),
  }),
  reason: z.string().max(1000).optional(),
  expectedVersion: VersionSchema,
});
export type PatchLabelRequest = z.infer<typeof PatchLabelRequestSchema>;

/**
 * `PATCH /labels/:id` response (§14.10, QA D-5): `changed: false` when the requested `accepted`
 * block equals the current one; such a PATCH is a no-op (no version bump, no LabelRevision).
 */
export const PatchLabelResponseSchema = z.object({ label: LabelSchema, changed: z.boolean() });
export type PatchLabelResponse = z.infer<typeof PatchLabelResponseSchema>;

export const BulkAcceptRequestSchema = z.object({
  segmentIds: z.array(IdSchema).min(1).max(2000),
  keys: z.array(LabelKeySchema).min(1),
});
export type BulkAcceptRequest = z.infer<typeof BulkAcceptRequestSchema>;

export const BulkAcceptResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type BulkAcceptResponse = z.infer<typeof BulkAcceptResponseSchema>;
