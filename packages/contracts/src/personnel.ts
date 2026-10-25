import { z } from 'zod';
import { IdSchema, TimestampSchema, UnitSchema, VersionSchema } from './common.js';
import { ImportRowErrorSchema } from './team.js';

// §9 Personnel ---------------------------------------------------------------------------------

export const PlayerStatusSchema = z.enum(['active', 'injured', 'unavailable', 'inactive']);
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;

/** Week-specific availability (v0.4, §15.2). A package with a player `out` for the game week is unavailable. */
export const AvailabilityStatusSchema = z.enum(['available', 'limited', 'out']);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;

export const PlayerAvailabilitySchema = z.object({
  week: z.number().int().min(0).max(52),
  status: AvailabilityStatusSchema,
  note: z.string().max(500),
});
export type PlayerAvailability = z.infer<typeof PlayerAvailabilitySchema>;

const PositionSchema = z.string().trim().min(1).max(16);

export const PlayerSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  seasonId: IdSchema,
  jersey: z.string().max(4).nullable(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  positions: z.array(PositionSchema),
  classYear: z.string().max(16),
  status: PlayerStatusSchema,
  strengths: z.array(z.string().max(200)),
  developmentPriorities: z.array(z.string().max(200)),
  notes: z.string().max(4000),
  availability: z.array(PlayerAvailabilitySchema),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Player = z.infer<typeof PlayerSchema>;

export const DepthChartSlotSchema = z.object({
  position: PositionSchema,
  order: z.number().int().positive(),
  playerId: IdSchema,
});
export type DepthChartSlot = z.infer<typeof DepthChartSlotSchema>;

export const DepthChartSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  seasonId: IdSchema,
  unit: UnitSchema,
  slots: z.array(DepthChartSlotSchema),
  version: VersionSchema,
  updatedAt: TimestampSchema,
});
export type DepthChart = z.infer<typeof DepthChartSchema>;

export const PersonnelPackageSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  seasonId: IdSchema,
  unit: UnitSchema,
  name: z.string().min(1).max(64),
  playerIds: z.array(IdSchema),
  description: z.string().max(2000),
  version: VersionSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type PersonnelPackage = z.infer<typeof PersonnelPackageSchema>;

// §15.2 requests (v0.4) --------------------------------------------------------------------------

export const CreatePlayerRequestSchema = z.object({
  jersey: z.string().trim().max(4).nullable().default(null),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  positions: z.array(PositionSchema).default([]),
  classYear: z.string().trim().max(16).default(''),
  status: PlayerStatusSchema.default('active'),
  strengths: z.array(z.string().max(200)).default([]),
  developmentPriorities: z.array(z.string().max(200)).default([]),
  notes: z.string().max(4000).default(''),
  availability: z.array(PlayerAvailabilitySchema).default([]),
});
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequestSchema>;

export const PatchPlayerRequestSchema = z.object({
  expectedVersion: VersionSchema,
  jersey: z.string().trim().max(4).nullable().optional(),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  positions: z.array(PositionSchema).optional(),
  classYear: z.string().trim().max(16).optional(),
  status: PlayerStatusSchema.optional(),
  strengths: z.array(z.string().max(200)).optional(),
  developmentPriorities: z.array(z.string().max(200)).optional(),
  notes: z.string().max(4000).optional(),
  /** Replaces the whole list; one entry per week. */
  availability: z.array(PlayerAvailabilitySchema).optional(),
});
export type PatchPlayerRequest = z.infer<typeof PatchPlayerRequestSchema>;

export const PlayersQuerySchema = z.object({
  /** Default: every status except `inactive`. `all` includes inactive (soft-deleted) players. */
  status: z.union([PlayerStatusSchema, z.literal('all')]).optional(),
});
export type PlayersQuery = z.infer<typeof PlayersQuerySchema>;

export const PutDepthChartRequestSchema = z.object({
  slots: z.array(DepthChartSlotSchema),
  /** Omit on the first write (no chart exists yet); afterwards required. */
  expectedVersion: VersionSchema.optional(),
});
export type PutDepthChartRequest = z.infer<typeof PutDepthChartRequestSchema>;

export const UnitQuerySchema = z.object({ unit: UnitSchema });
export type UnitQuery = z.infer<typeof UnitQuerySchema>;

export const OptionalUnitQuerySchema = z.object({ unit: UnitSchema.optional() });
export type OptionalUnitQuery = z.infer<typeof OptionalUnitQuerySchema>;

export const CreatePackageRequestSchema = z.object({
  unit: UnitSchema,
  name: z.string().trim().min(1).max(64),
  playerIds: z.array(IdSchema).default([]),
  description: z.string().max(2000).default(''),
});
export type CreatePackageRequest = z.infer<typeof CreatePackageRequestSchema>;

export const PatchPackageRequestSchema = z.object({
  expectedVersion: VersionSchema,
  name: z.string().trim().min(1).max(64).optional(),
  playerIds: z.array(IdSchema).optional(),
  description: z.string().max(2000).optional(),
});
export type PatchPackageRequest = z.infer<typeof PatchPackageRequestSchema>;

// §15.2 roster import (same preview/apply machinery as schedule imports) --------------------------

export const RosterImportFieldSchema = z.enum(['jersey', 'first', 'last', 'name', 'positions', 'class', 'status', 'notes', 'ignore']);
export type RosterImportField = z.infer<typeof RosterImportFieldSchema>;

export const RosterImportRowSchema = z.object({
  row: z.number().int().positive(),
  jersey: z.string().max(4).nullable(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  positions: z.array(PositionSchema),
  classYear: z.string().max(16),
  status: PlayerStatusSchema,
  notes: z.string(),
  /** Set in the preview when an existing player matches on jersey + last name (apply updates it). */
  matchesPlayerId: IdSchema.nullable(),
});
export type RosterImportRow = z.infer<typeof RosterImportRowSchema>;

export const RosterImportStatusSchema = z.enum(['previewed', 'applied', 'discarded']);

export const RosterImportSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  seasonId: IdSchema,
  filename: z.string().min(1).max(255),
  status: RosterImportStatusSchema,
  mapping: z.record(z.string(), RosterImportFieldSchema),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(RosterImportRowSchema),
  errors: z.array(ImportRowErrorSchema),
  createdAt: TimestampSchema,
});
export type RosterImport = z.infer<typeof RosterImportSchema>;

export const RosterImportPreviewRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  /** Raw CSV text (UTF-8). */
  content: z.string().min(1).max(2_000_000),
  mapping: z.record(z.string(), RosterImportFieldSchema).optional(),
});
export type RosterImportPreviewRequest = z.infer<typeof RosterImportPreviewRequestSchema>;

export const RosterImportApplyRequestSchema = z.object({ skipInvalidRows: z.boolean().default(false) });
export type RosterImportApplyRequest = z.infer<typeof RosterImportApplyRequestSchema>;

export const RosterImportApplyResultSchema = z.object({
  import: RosterImportSchema,
  createdPlayerIds: z.array(IdSchema),
  updatedPlayerIds: z.array(IdSchema),
  skippedRows: z.array(z.number().int().positive()),
});
export type RosterImportApplyResult = z.infer<typeof RosterImportApplyResultSchema>;
