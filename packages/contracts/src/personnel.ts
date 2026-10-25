import { z } from 'zod';
import { IdSchema, UnitSchema, VersionSchema } from './common.js';

// §9 Personnel ---------------------------------------------------------------------------------

export const PlayerStatusSchema = z.enum(['active', 'injured', 'unavailable', 'inactive']);
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;

export const PlayerSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  seasonId: IdSchema,
  jersey: z.string().max(4).nullable(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  positions: z.array(z.string().min(1).max(16)),
  classYear: z.string().max(16),
  status: PlayerStatusSchema,
  strengths: z.array(z.string().max(200)),
  developmentPriorities: z.array(z.string().max(200)),
  notes: z.string().max(4000),
  version: VersionSchema,
});
export type Player = z.infer<typeof PlayerSchema>;

export const DepthChartSlotSchema = z.object({
  position: z.string().min(1).max(16),
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
});
export type PersonnelPackage = z.infer<typeof PersonnelPackageSchema>;
