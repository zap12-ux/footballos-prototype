import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { GameResult, ImportRowError, ScheduleImportField, ScheduleImportRow, Unit } from '@footballos/contracts';

// Column conventions: ids are UUID v4 text; timestamps are ISO 8601 UTC text ending in _at;
// booleans are integer 0/1; JSON columns are text with mode 'json'.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
  mfaSecret: text('mfa_secret'),
  mfaPendingSecret: text('mfa_pending_secret'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('users_email_unique').on(t.email)]);

export const recoveryCodes = sqliteTable('recovery_codes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull(),
}, (t) => [index('recovery_codes_user_idx').on(t.userId)]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  /** Absolute expiry (30 d). Idle expiry is computed from lastSeenAt + SESSION_TTL_HOURS. */
  expiresAt: text('expires_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
  mfaVerified: integer('mfa_verified', { mode: 'boolean' }).notNull().default(false),
  ipHash: text('ip_hash'),
  userAgent: text('user_agent'),
  revokedAt: text('revoked_at'),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const passwordRecoveryTokens = sqliteTable('password_recovery_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull(),
}, (t) => [uniqueIndex('password_recovery_tokens_hash_unique').on(t.tokenHash)]);

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  level: text('level').notNull(),
  environmentKind: text('environment_kind').notNull(),
  timezone: text('timezone').notNull(),
  createdAt: text('created_at').notNull(),
});

export const staffMemberships = sqliteTable('staff_memberships', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  units: text('units', { mode: 'json' }).$type<Unit[]>().notNull(),
  title: text('title').notNull().default(''),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  uniqueIndex('staff_memberships_team_user_unique').on(t.teamId, t.userId),
  index('staff_memberships_user_idx').on(t.userId),
]);

export const invites = sqliteTable('invites', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull(),
  unit: text('unit'),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'),
  revokedAt: text('revoked_at'),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
}, (t) => [
  uniqueIndex('invites_token_hash_unique').on(t.tokenHash),
  index('invites_team_idx').on(t.teamId),
]);

export const seasons = sqliteTable('seasons', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (t) => [index('seasons_team_idx').on(t.teamId)]);

export const opponents = sqliteTable('opponents', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
}, (t) => [index('opponents_team_idx').on(t.teamId)]);

export const scheduledGames = sqliteTable('scheduled_games', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  seasonId: text('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  week: integer('week'),
  kind: text('kind').notNull(),
  opponentId: text('opponent_id').references(() => opponents.id),
  location: text('location'),
  scheduledAt: text('scheduled_at'),
  status: text('status').notNull(),
  result: text('result', { mode: 'json' }).$type<GameResult | null>(),
  notes: text('notes').notNull().default(''),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [index('scheduled_games_team_season_idx').on(t.teamId, t.seasonId)]);

export const gameWorkspaces = sqliteTable('game_workspaces', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull().references(() => scheduledGames.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
}, (t) => [uniqueIndex('game_workspaces_game_unique').on(t.gameId)]);

export const scheduleImports = sqliteTable('schedule_imports', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  seasonId: text('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  status: text('status').notNull(),
  mapping: text('mapping', { mode: 'json' }).$type<Record<string, ScheduleImportField>>().notNull(),
  rowCount: integer('row_count').notNull(),
  rows: text('rows', { mode: 'json' }).$type<ScheduleImportRow[]>().notNull(),
  errors: text('errors', { mode: 'json' }).$type<ImportRowError[]>().notNull(),
  createdBy: text('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull(),
}, (t) => [index('schedule_imports_team_idx').on(t.teamId)]);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  actorUserId: text('actor_user_id'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  at: text('at').notNull(),
  details: text('details', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
}, (t) => [index('audit_events_team_at_idx').on(t.teamId, t.at)]);
