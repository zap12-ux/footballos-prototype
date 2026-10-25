import { z } from 'zod';
import { IdSchema, TimestampSchema, UnitSchema, VersionSchema } from './common.js';
import { EvidenceRefSchema } from './labels.js';

// §10 Recommendations ---------------------------------------------------------------------------

export const RecommendationStatusSchema = z.enum(['proposed', 'accepted', 'edited', 'rejected', 'deferred', 'stale']);
export type RecommendationStatus = z.infer<typeof RecommendationStatusSchema>;

export const RecommendationCountSchema = z
  .object({
    n: z.number().int().nonnegative(),
    of: z.number().int().nonnegative(),
    context: z.string().min(1),
  })
  .refine((c) => c.n <= c.of, { message: 'n cannot exceed of', path: ['n'] });
export type RecommendationCount = z.infer<typeof RecommendationCountSchema>;

export const RecommendationSchema = z
  .object({
    id: IdSchema,
    teamId: IdSchema,
    gameId: IdSchema,
    unit: UnitSchema,
    statement: z.string().min(1),
    supportingFindings: z.array(IdSchema),
    supportingEvidence: z.array(EvidenceRefSchema),
    counts: z.array(RecommendationCountSchema),
    limitations: z.array(z.string()),
    contraryEvidence: z.array(EvidenceRefSchema),
    playbookConceptIds: z.array(IdSchema),
    personnelPackageIds: z.array(IdSchema),
    status: RecommendationStatusSchema,
    staleReason: z.string().nullable(),
    decidedBy: IdSchema.nullable(),
    decidedAt: TimestampSchema.nullable(),
    inputsHash: z.string().min(1),
    createdAt: TimestampSchema,
    version: VersionSchema,
  })
  .refine((r) => (r.status === 'stale' ? r.staleReason !== null : true), {
    message: 'a stale recommendation states its staleReason',
    path: ['staleReason'],
  });
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const RecommendationDecisionRequestSchema = z.object({
  expectedVersion: VersionSchema,
  decision: z.enum(['accepted', 'edited', 'rejected', 'deferred']),
  /** Required when `decision` is `edited`. */
  editedStatement: z.string().min(1).optional(),
});
export type RecommendationDecisionRequest = z.infer<typeof RecommendationDecisionRequestSchema>;
