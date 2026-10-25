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

export const GamePlanVersionSchema = z.object({
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
  version: VersionSchema,
});
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
