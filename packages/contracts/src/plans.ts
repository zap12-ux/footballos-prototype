import { z } from 'zod';
import { IdSchema, TimestampSchema, UnitSchema, VersionSchema } from './common.js';

// §11 Weekly unit game plans --------------------------------------------------------------------

export const OffenseSectionKeySchema = z.enum([
  'objectives',
  'personnel',
  'formations',
  'runs',
  'passes',
  'protections',
  'opening_script',
  'third_down',
  'red_zone',
  'short_yardage',
  'two_minute',
]);
export type OffenseSectionKey = z.infer<typeof OffenseSectionKeySchema>;

export const DefenseSectionKeySchema = z.enum([
  'opponent_tendencies',
  'fronts',
  'fits',
  'coverages',
  'pressures',
  'matchups',
  'third_down',
  'red_zone',
  'short_yardage',
  'two_minute',
]);
export type DefenseSectionKey = z.infer<typeof DefenseSectionKeySchema>;

export const SpecialTeamsSectionKeySchema = z.enum([
  'kickoff_return',
  'punt_protection_return',
  'fg_pat',
  'opponent_alerts',
  'special_situations',
]);
export type SpecialTeamsSectionKey = z.infer<typeof SpecialTeamsSectionKeySchema>;

export const PlanSectionKeySchema = z.union([OffenseSectionKeySchema, DefenseSectionKeySchema, SpecialTeamsSectionKeySchema]);
export type PlanSectionKey = z.infer<typeof PlanSectionKeySchema>;

export const PLAN_SECTION_KEYS_BY_UNIT = {
  offense: OffenseSectionKeySchema.options,
  defense: DefenseSectionKeySchema.options,
  special_teams: SpecialTeamsSectionKeySchema.options,
} as const;

export const PlanItemSchema = z.object({
  id: IdSchema,
  text: z.string().min(1).max(4000),
  sourceRecommendationId: IdSchema.nullable(),
  conceptIds: z.array(IdSchema),
  packageIds: z.array(IdSchema),
  order: z.number().int().nonnegative(),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const PlanSectionSchema = z.object({
  key: PlanSectionKeySchema,
  title: z.string().min(1).max(120),
  items: z.array(PlanItemSchema),
});
export type PlanSection = z.infer<typeof PlanSectionSchema>;

export const PlanVersionStatusSchema = z.enum(['draft', 'in_review', 'approved', 'superseded']);
export type PlanVersionStatus = z.infer<typeof PlanVersionStatusSchema>;

export const GamePlanSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  gameId: IdSchema,
  unit: UnitSchema,
  currentVersionId: IdSchema,
  createdAt: TimestampSchema,
});
export type GamePlan = z.infer<typeof GamePlanSchema>;

/**
 * Approval history lives on the version and is never cleared (iteration 1, HC-03): a
 * superseded version keeps `approvedBy`, `approvedAt`, `override` and `overrideReason`, and
 * records when and by which later version it was superseded. A head-coach override always
 * carries a reason.
 */
const GamePlanVersionBaseSchema = z.object({
  id: IdSchema,
  planId: IdSchema,
  number: z.number().int().positive(),
  status: PlanVersionStatusSchema,
  basedOn: IdSchema.nullable(),
  sections: z.array(PlanSectionSchema),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  approvedBy: IdSchema.nullable(),
  approvedAt: TimestampSchema.nullable(),
  override: z.boolean(),
  /** Required when `override` is true; null otherwise. Kept forever with the version and in the audit event. */
  overrideReason: z.string().trim().min(1).max(2000).nullable(),
  /** Set when a later version was approved over this one; the approval fields above stay as they were. */
  supersededAt: TimestampSchema.nullable(),
  supersededByVersionId: IdSchema.nullable(),
  version: VersionSchema,
});
const overrideNeedsReason = (v: { override: boolean; overrideReason: string | null }) => !v.override || (v.overrideReason !== null && v.overrideReason.trim().length > 0);
const OVERRIDE_REASON_MESSAGE = { message: 'a head-coach override records a reason', path: ['overrideReason'] as (string | number)[] };

export const GamePlanVersionSchema = GamePlanVersionBaseSchema.refine(overrideNeedsReason, OVERRIDE_REASON_MESSAGE);
export type GamePlanVersion = z.infer<typeof GamePlanVersionSchema>;

export const PlanCommentSchema = z.object({
  id: IdSchema,
  versionId: IdSchema,
  sectionKey: PlanSectionKeySchema.nullable(),
  itemId: IdSchema.nullable(),
  authorUserId: IdSchema,
  body: z.string().min(1).max(4000),
  createdAt: TimestampSchema,
  resolvedAt: TimestampSchema.nullable(),
});
export type PlanComment = z.infer<typeof PlanCommentSchema>;

export const ShareTargetTypeSchema = z.enum(['plan_version', 'report_snapshot']);
export type ShareTargetType = z.infer<typeof ShareTargetTypeSchema>;

export const ShareLinkSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  targetType: ShareTargetTypeSchema,
  targetId: IdSchema,
  /** Hash of the token; the raw token is shown once at creation. */
  tokenHash: z.string().min(1),
  expiresAt: TimestampSchema,
  createdBy: IdSchema,
  revokedAt: TimestampSchema.nullable(),
});
export type ShareLink = z.infer<typeof ShareLinkSchema>;

// §15.4 unit game plans: requests, responses, review flags, sharing (v0.4) ------------------------

/** Longest lifetime of a share link in hours (owner decision 2026-10-25: 72 h, lowered from the 168 h draft cap). */
export const SHARE_LINK_MAX_HOURS = 72;

export const ReviewFlagKindSchema = z.enum(['stale_recommendation', 'playbook_changed', 'personnel_changed', 'labels_changed']);
export type ReviewFlagKind = z.infer<typeof ReviewFlagKindSchema>;

/** Computed on read by comparing stored `inputsHash` values with current inputs; never stored. */
export const ReviewFlagSchema = z.object({
  kind: ReviewFlagKindSchema,
  message: z.string().min(1),
  /** The version the flag is about. */
  versionId: IdSchema,
  itemId: IdSchema.nullable(),
  /** Earliest time the stale input was known to differ (the version's or recommendation's creation time). */
  since: TimestampSchema,
});
export type ReviewFlag = z.infer<typeof ReviewFlagSchema>;

export const GamePlanVersionSummarySchema = GamePlanVersionBaseSchema.omit({ sections: true })
  .extend({
    itemCount: z.number().int().nonnegative(),
  })
  .refine(overrideNeedsReason, OVERRIDE_REASON_MESSAGE);
export type GamePlanVersionSummary = z.infer<typeof GamePlanVersionSummarySchema>;

export const GamePlanResponseSchema = z.object({
  plan: GamePlanSchema,
  versions: z.array(GamePlanVersionSummarySchema),
  current: GamePlanVersionSchema,
  reviewFlags: z.array(ReviewFlagSchema),
});
export type GamePlanResponse = z.infer<typeof GamePlanResponseSchema>;

export const PatchPlanVersionRequestSchema = z.object({
  sections: z.array(PlanSectionSchema),
  expectedVersion: VersionSchema,
});
export type PatchPlanVersionRequest = z.infer<typeof PatchPlanVersionRequestSchema>;

export const PlanVersionResponseSchema = z.object({ version: GamePlanVersionSchema });
export type PlanVersionResponse = z.infer<typeof PlanVersionResponseSchema>;

export const PlanTransitionRequestSchema = z.object({ note: z.string().max(2000).optional() });
export type PlanTransitionRequest = z.infer<typeof PlanTransitionRequestSchema>;

/** `POST /plan-versions/:id/approve`: a head coach approving a unit plan must give `overrideReason` (400 otherwise). */
export const ApprovePlanVersionRequestSchema = PlanTransitionRequestSchema.extend({
  overrideReason: z.string().trim().min(1).max(2000).optional(),
});
export type ApprovePlanVersionRequest = z.infer<typeof ApprovePlanVersionRequestSchema>;

export const CreatePlanCommentRequestSchema = z.object({
  sectionKey: PlanSectionKeySchema.optional(),
  itemId: IdSchema.optional(),
  body: z.string().trim().min(1).max(4000),
});
export type CreatePlanCommentRequest = z.infer<typeof CreatePlanCommentRequestSchema>;

export const CreateShareLinkRequestSchema = z.object({
  /** Hours until expiry; at most `SHARE_LINK_MAX_HOURS` (72), default 72. Longer requests are a validation error. */
  expiresInHours: z.number().positive().max(SHARE_LINK_MAX_HOURS).default(SHARE_LINK_MAX_HOURS),
});
export type CreateShareLinkRequest = z.infer<typeof CreateShareLinkRequestSchema>;

/** The raw token appears only here, once. */
export const CreateShareLinkResponseSchema = z.object({ link: ShareLinkSchema, url: z.string().min(1), token: z.string().min(1) });
export type CreateShareLinkResponse = z.infer<typeof CreateShareLinkResponseSchema>;

/** `GET /shared/:token`: read-only approved plan version, no session. */
export const SharedPlanResponseSchema = z.object({
  version: GamePlanVersionSchema,
  team: z.object({ name: z.string(), shortName: z.string(), environmentKind: z.enum(['demo', 'research', 'production']) }),
  game: z.object({ id: IdSchema, week: z.number().int().nullable(), scheduledAt: TimestampSchema.nullable(), opponentName: z.string().nullable(), location: z.string().nullable() }),
  unit: UnitSchema,
  expiresAt: TimestampSchema,
});
export type SharedPlanResponse = z.infer<typeof SharedPlanResponseSchema>;
