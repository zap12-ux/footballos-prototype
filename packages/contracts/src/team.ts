import { z } from 'zod';
import { DateOnlySchema, EnvironmentKindSchema, IdSchema, TimestampSchema, VersionSchema } from './common.js';

// §4 Team, season, schedule ---------------------------------------------------------------

export const TeamLevelSchema = z.enum(['high_school', 'college', 'other']);
export type TeamLevel = z.infer<typeof TeamLevelSchema>;

export const TeamSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(32),
  level: TeamLevelSchema,
  environmentKind: EnvironmentKindSchema,
  /** IANA time zone, e.g. `America/New_York`. */
  timezone: z.string().min(1).max(64),
  createdAt: TimestampSchema,
});
export type Team = z.infer<typeof TeamSchema>;

export const SeasonSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  label: z.string().trim().min(1).max(32),
  startsOn: DateOnlySchema,
  endsOn: DateOnlySchema,
  isCurrent: z.boolean(),
});
export type Season = z.infer<typeof SeasonSchema>;

export const OpponentSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(32),
  notes: z.string().max(4000),
});
export type Opponent = z.infer<typeof OpponentSchema>;

export const GameKindSchema = z.enum(['regular', 'bye', 'scrimmage', 'playoff', 'other']);
export type GameKind = z.infer<typeof GameKindSchema>;

export const GameLocationSchema = z.enum(['home', 'away', 'neutral']);
export type GameLocation = z.infer<typeof GameLocationSchema>;

export const GameStatusSchema = z.enum(['scheduled', 'rescheduled', 'postponed', 'canceled', 'final']);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const GameOutcomeSchema = z.enum(['win', 'loss', 'tie']);
export type GameOutcome = z.infer<typeof GameOutcomeSchema>;

export const GameResultSchema = z
  .object({
    ourScore: z.number().int().nonnegative(),
    theirScore: z.number().int().nonnegative(),
    outcome: GameOutcomeSchema,
  })
  .refine(
    (r) =>
      (r.outcome === 'win' && r.ourScore > r.theirScore) ||
      (r.outcome === 'loss' && r.ourScore < r.theirScore) ||
      (r.outcome === 'tie' && r.ourScore === r.theirScore),
    { message: 'outcome must agree with the scores' },
  );
export type GameResult = z.infer<typeof GameResultSchema>;

export const ScheduledGameSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  seasonId: IdSchema,
  week: z.number().int().min(0).max(52).nullable(),
  kind: GameKindSchema,
  opponentId: IdSchema.nullable(),
  location: GameLocationSchema.nullable(),
  scheduledAt: TimestampSchema.nullable(),
  status: GameStatusSchema,
  result: GameResultSchema.nullable(),
  notes: z.string().max(4000),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type ScheduledGame = z.infer<typeof ScheduledGameSchema>;

/** 1:1 with ScheduledGame; stable id. All film, scouting and plans hang off gameId, never off the date. */
export const GameWorkspaceSchema = z.object({
  id: IdSchema,
  gameId: IdSchema,
  teamId: IdSchema,
});
export type GameWorkspace = z.infer<typeof GameWorkspaceSchema>;

/** Computed in application code from `status:'final'` games; bye and canceled games are excluded. Never stored. */
export const SeasonRecordSchema = z.object({
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  ties: z.number().int().nonnegative(),
  /** Number of final games the record is computed from. */
  played: z.number().int().nonnegative(),
});
export type SeasonRecord = z.infer<typeof SeasonRecordSchema>;

export const ImportRowErrorSchema = z.object({
  /** 1-based data row number (header row excluded). */
  row: z.number().int().positive(),
  column: z.string().nullable(),
  message: z.string().min(1),
});
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;

export const ScheduleImportStatusSchema = z.enum(['previewed', 'applied', 'discarded']);
export type ScheduleImportStatus = z.infer<typeof ScheduleImportStatusSchema>;

/** Target fields a schedule import column can be mapped to. */
export const ScheduleImportFieldSchema = z.enum(['week', 'date', 'time', 'opponent', 'location', 'kind', 'notes', 'ignore']);
export type ScheduleImportField = z.infer<typeof ScheduleImportFieldSchema>;

/** One parsed, validated row of a previewed import (what `apply` will create). */
export const ScheduleImportRowSchema = z.object({
  row: z.number().int().positive(),
  week: z.number().int().min(0).max(52).nullable(),
  kind: GameKindSchema,
  opponentName: z.string().nullable(),
  location: GameLocationSchema.nullable(),
  scheduledAt: TimestampSchema.nullable(),
  notes: z.string(),
});
export type ScheduleImportRow = z.infer<typeof ScheduleImportRowSchema>;

export const ScheduleImportSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  seasonId: IdSchema,
  filename: z.string().min(1).max(255),
  status: ScheduleImportStatusSchema,
  /** source column header → target field */
  mapping: z.record(z.string(), ScheduleImportFieldSchema),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(ScheduleImportRowSchema),
  errors: z.array(ImportRowErrorSchema),
  createdAt: TimestampSchema,
});
export type ScheduleImport = z.infer<typeof ScheduleImportSchema>;

// Request shapes ---------------------------------------------------------------------------

export const CreateSeasonRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(32),
    startsOn: DateOnlySchema,
    endsOn: DateOnlySchema,
    isCurrent: z.boolean().default(false),
  })
  .refine((s) => s.startsOn <= s.endsOn, { message: 'startsOn must not be after endsOn', path: ['endsOn'] });
export type CreateSeasonRequest = z.infer<typeof CreateSeasonRequestSchema>;

export const CreateOpponentRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  shortName: z.string().trim().min(1).max(32).optional(),
  notes: z.string().max(4000).default(''),
});
export type CreateOpponentRequest = z.infer<typeof CreateOpponentRequestSchema>;

export const CreateGameRequestSchema = z.object({
  week: z.number().int().min(0).max(52).nullable().default(null),
  kind: GameKindSchema.default('regular'),
  opponentId: IdSchema.nullable().default(null),
  location: GameLocationSchema.nullable().default(null),
  scheduledAt: TimestampSchema.nullable().default(null),
  notes: z.string().max(4000).default(''),
});
export type CreateGameRequest = z.infer<typeof CreateGameRequestSchema>;

export const PatchGameRequestSchema = z.object({
  expectedVersion: VersionSchema,
  week: z.number().int().min(0).max(52).nullable().optional(),
  kind: GameKindSchema.optional(),
  opponentId: IdSchema.nullable().optional(),
  location: GameLocationSchema.nullable().optional(),
  scheduledAt: TimestampSchema.nullable().optional(),
  status: GameStatusSchema.optional(),
  result: GameResultSchema.nullable().optional(),
  notes: z.string().max(4000).optional(),
});
export type PatchGameRequest = z.infer<typeof PatchGameRequestSchema>;

export const ScheduleImportPreviewRequestSchema = z.object({
  seasonId: IdSchema,
  filename: z.string().trim().min(1).max(255),
  /** Raw CSV text (UTF-8). `.xlsx` is not accepted yet; export the sheet as CSV. */
  content: z.string().min(1).max(2_000_000),
  /** Optional explicit header → field mapping; headers are auto-detected when omitted. */
  mapping: z.record(z.string(), ScheduleImportFieldSchema).optional(),
});
export type ScheduleImportPreviewRequest = z.infer<typeof ScheduleImportPreviewRequestSchema>;

export const ScheduleImportApplyRequestSchema = z.object({
  /** When false (default) an import with row errors is refused with `409 conflict`. */
  skipInvalidRows: z.boolean().default(false),
});
export type ScheduleImportApplyRequest = z.infer<typeof ScheduleImportApplyRequestSchema>;

export const ScheduleImportApplyResultSchema = z.object({
  import: ScheduleImportSchema,
  createdGameIds: z.array(IdSchema),
  createdOpponentIds: z.array(IdSchema),
  skippedRows: z.array(z.number().int().positive()),
});
export type ScheduleImportApplyResult = z.infer<typeof ScheduleImportApplyResultSchema>;

// Ops ---------------------------------------------------------------------------------------

export const UsageSchema = z.object({
  teamId: IdSchema,
  /** `YYYY-MM` in UTC. */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  monthlyCostCapUsd: z.number().nonnegative(),
  jobsSucceeded: z.number().int().nonnegative(),
  jobsFailed: z.number().int().nonnegative(),
  byKind: z.array(
    z.object({
      kind: z.string(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      costUsd: z.number().nonnegative(),
    }),
  ),
});
export type Usage = z.infer<typeof UsageSchema>;

export const HealthSchema = z.object({
  ok: z.literal(true),
  environment: z.enum(['development', 'demo', 'research', 'production']),
  version: z.string(),
  now: TimestampSchema,
});
export type Health = z.infer<typeof HealthSchema>;
