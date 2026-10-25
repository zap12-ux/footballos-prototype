import { z } from 'zod';
import { IdSchema, TimestampSchema, UnitSchema } from './common.js';
import { EvidenceRefSchema } from './labels.js';

// §7 Scouting findings and report snapshots ---------------------------------------------

export const FindingKindSchema = z.enum([
  'formation_frequency',
  'play_type_by_formation',
  'tendency_by_situation',
  'strength',
  'weakness',
  'uncertain',
]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const ReviewBasisSchema = z.enum(['reviewed_only', 'includes_inferred']);
export type ReviewBasis = z.infer<typeof ReviewBasisSchema>;

export const ScoutingFindingSchema = z
  .object({
    id: IdSchema,
    teamId: IdSchema,
    opponentId: IdSchema,
    gameIds: z.array(IdSchema),
    unit: UnitSchema,
    kind: FindingKindSchema,
    statement: z.string().min(1),
    numerator: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    percent: z.number().min(0).max(100).nullable(),
    sampleSize: z.number().int().nonnegative(),
    includedSegmentIds: z.array(IdSchema),
    excludedSegmentIds: z.array(IdSchema),
    excludedReason: z.record(z.string(), z.string()),
    reviewBasis: ReviewBasisSchema,
    supportingEvidence: z.array(EvidenceRefSchema),
    contraryEvidence: z.array(EvidenceRefSchema),
    computedAt: TimestampSchema,
    computeVersion: z.string().min(1),
  })
  .refine((f) => f.numerator <= f.denominator, { message: 'numerator cannot exceed denominator', path: ['numerator'] })
  .refine((f) => (f.denominator === 0 ? f.percent === null : true), {
    message: 'percent must be null when the denominator is 0',
    path: ['percent'],
  });
export type ScoutingFinding = z.infer<typeof ScoutingFindingSchema>;

export const ReportSnapshotSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  opponentId: IdSchema,
  title: z.string().min(1).max(200),
  findings: z.array(ScoutingFindingSchema),
  generatedBy: IdSchema,
  generatedAt: TimestampSchema,
  inputsHash: z.string().min(1),
});
export type ReportSnapshot = z.infer<typeof ReportSnapshotSchema>;

// §14.6 Computed scouting (v0.3) ---------------------------------------------------------

const idList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
  z.array(IdSchema),
);

export const ScoutingQuerySchema = z.object({
  unit: UnitSchema,
  reviewBasis: ReviewBasisSchema.default('reviewed_only'),
  /** Comma-separated game ids; omitted = every game against the opponent. */
  gameIds: idList.optional(),
});
export type ScoutingQuery = z.infer<typeof ScoutingQuerySchema>;

export const ScoutingResponseSchema = z.object({
  findings: z.array(ScoutingFindingSchema),
  games: z.array(z.object({ gameId: IdSchema, assetIds: z.array(IdSchema) })),
  sampleSize: z.number().int().nonnegative(),
  computedAt: TimestampSchema,
  computeVersion: z.string().min(1),
});
export type ScoutingResponse = z.infer<typeof ScoutingResponseSchema>;

export const CreateSnapshotRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Omitted = findings for all three units are included. */
  unit: UnitSchema.optional(),
  reviewBasis: ReviewBasisSchema.default('reviewed_only'),
  gameIds: z.array(IdSchema).optional(),
});
export type CreateSnapshotRequest = z.infer<typeof CreateSnapshotRequestSchema>;
