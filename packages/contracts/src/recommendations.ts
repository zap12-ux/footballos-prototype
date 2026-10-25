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
    /** v0.4: the coach's wording when the decision was `edit`; the stored decision is never rewritten. */
    editedStatement: z.string().nullable(),
    /** v0.4: coach note recorded with the decision. */
    decisionNote: z.string().nullable(),
    /** v0.4: the stored decision, kept even while the item is reported `stale` on read. */
    storedStatus: RecommendationStatusSchema,
    /** v0.4: the plan item created by an `accept`/`edit` decision. */
    planItemId: IdSchema.nullable(),
  })
  .refine((r) => (r.status === 'stale' ? r.staleReason !== null : true), {
    message: 'a stale recommendation states its staleReason',
    path: ['staleReason'],
  });
export type Recommendation = z.infer<typeof RecommendationSchema>;

// §15.3 requests and responses (v0.4) -----------------------------------------------------------

export const GenerateRecommendationsRequestSchema = z.object({ unit: UnitSchema });
export type GenerateRecommendationsRequest = z.infer<typeof GenerateRecommendationsRequestSchema>;

/** `201 { items, blockedReasons, inputsHash }`; `items` is `[]` with reasons when generation is not grounded. */
export const GenerateRecommendationsResponseSchema = z.object({
  items: z.array(RecommendationSchema),
  blockedReasons: z.array(z.string()),
  inputsHash: z.string().min(1),
  /** Undecided recommendations of a previous generation that were superseded (`rejected`, `staleReason: 'regenerated'`). */
  supersededIds: z.array(IdSchema),
});
export type GenerateRecommendationsResponse = z.infer<typeof GenerateRecommendationsResponseSchema>;

export const RecommendationsQuerySchema = z.object({ unit: UnitSchema.optional() });
export type RecommendationsQuery = z.infer<typeof RecommendationsQuerySchema>;

export const RecommendationDecisionRequestSchema = z
  .object({
    decision: z.enum(['accept', 'edit', 'reject', 'defer']),
    /** Required when `decision` is `edit`. */
    editedStatement: z.string().trim().min(1).max(4000).optional(),
    note: z.string().max(2000).optional(),
    expectedVersion: VersionSchema.optional(),
  })
  .refine((r) => r.decision !== 'edit' || Boolean(r.editedStatement), { message: 'editedStatement is required for an edit decision', path: ['editedStatement'] });
export type RecommendationDecisionRequest = z.infer<typeof RecommendationDecisionRequestSchema>;

export const RecommendationDecisionResponseSchema = z.object({
  recommendation: RecommendationSchema,
  /** The draft plan version that received the item (accept/edit), else null. */
  planVersionId: IdSchema.nullable(),
  planItemId: IdSchema.nullable(),
});
export type RecommendationDecisionResponse = z.infer<typeof RecommendationDecisionResponseSchema>;
