import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type {
  AcceptedLabel, FootageQuality, GameResult, ImportRowError, InferredLabel, JobError, JobProgress, ModelProvenance, ScheduleImportField,
  ScheduleImportRow, ScoutingFinding, Unit, UploadContext,
} from '@footballos/contracts';

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

// Milestone B (migration 0001_media_labels): media, uploads, jobs, segments, labels, provenance,
// snapshots, settings. Owned by B; see CONTRACTS §5–§7 and §14.

export const mediaAssets = sqliteTable('media_assets', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  gameId: text('game_id').notNull().references(() => scheduledGames.id, { onDelete: 'cascade' }),
  uploadedBy: text('uploaded_by').notNull().references(() => users.id),
  kind: text('kind').notNull(),
  originalFilename: text('original_filename').notNull(),
  byteSize: integer('byte_size').notNull(),
  /** Null while uploading; set from the stored bytes at completion. */
  sha256: text('sha256'),
  mimeType: text('mime_type').notNull(),
  durationSec: real('duration_sec'),
  width: integer('width'),
  height: integer('height'),
  fps: real('fps'),
  /** Container family from the validate probe (mp4, mov, mkv, ...); null until validated. Drives the stream Content-Type (never the client mimeType). */
  container: text('container'),
  status: text('status').notNull(),
  rejectionReason: text('rejection_reason'),
  context: text('context', { mode: 'json' }).$type<UploadContext>().notNull(),
  quality: text('quality', { mode: 'json' }).$type<FootageQuality | null>(),
  /** Path relative to FOOTBALLOS_DATA_DIR, e.g. media/<teamId>/<assetId>/original.mp4. */
  storageKey: text('storage_key').notNull(),
  proxyStorageKey: text('proxy_storage_key'),
  thumbnailSheetKey: text('thumbnail_sheet_key'),
  retentionUntil: text('retention_until'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('media_assets_team_game_idx').on(t.teamId, t.gameId),
  index('media_assets_team_sha_idx').on(t.teamId, t.sha256),
]);

export const uploads = sqliteTable('uploads', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull().references(() => mediaAssets.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  chunkSizeBytes: integer('chunk_size_bytes').notNull(),
  receivedBytes: integer('received_bytes').notNull().default(0),
  totalBytes: integer('total_bytes').notNull(),
  /** Client-declared hash, verified at completion. */
  expectedSha256: text('expected_sha256'),
  expiresAt: text('expires_at').notNull(),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
}, (t) => [index('uploads_team_idx').on(t.teamId), index('uploads_expires_idx').on(t.expiresAt)]);

export const processingJobs = sqliteTable('processing_jobs', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  progress: text('progress', { mode: 'json' }).$type<JobProgress>().notNull(),
  attempt: integer('attempt').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull(),
  leaseExpiresAt: text('lease_expires_at'),
  workerId: text('worker_id'),
  idempotencyKey: text('idempotency_key').notNull(),
  configVersion: text('config_version').notNull(),
  error: text('error', { mode: 'json' }).$type<JobError | null>(),
  requestedBy: text('requested_by'),
  createdAt: text('created_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  canceledAt: text('canceled_at'),
  /** Store-internal fields proposed by C (CONTRACTS §13/§14.2). */
  input: text('input', { mode: 'json' }).$type<unknown>(),
  result: text('result', { mode: 'json' }).$type<unknown>(),
  notBeforeAt: text('not_before_at'),
  cancelRequestedAt: text('cancel_requested_at'),
  /** Chain ordering: claimable only once this job has succeeded; failed/canceled upstream fails this job too. */
  dependsOnJobId: text('depends_on_job_id'),
}, (t) => [
  uniqueIndex('processing_jobs_idempotency_unique').on(t.idempotencyKey),
  index('processing_jobs_team_created_idx').on(t.teamId, t.createdAt),
  index('processing_jobs_status_idx').on(t.status),
  index('processing_jobs_asset_idx').on(t.assetId),
]);

export const playSegments = sqliteTable('play_segments', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').notNull().references(() => mediaAssets.id, { onDelete: 'cascade' }),
  gameId: text('game_id').notNull().references(() => scheduledGames.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  startSec: real('start_sec').notNull(),
  endSec: real('end_sec').notNull(),
  origin: text('origin').notNull(),
  reviewStatus: text('review_status').notNull(),
  supersededBy: text('superseded_by', { mode: 'json' }).$type<string[]>().notNull(),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [index('play_segments_asset_idx').on(t.assetId), index('play_segments_team_game_idx').on(t.teamId, t.gameId)]);

export const labels = sqliteTable('labels', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  segmentId: text('segment_id').notNull().references(() => playSegments.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  inferred: text('inferred', { mode: 'json' }).$type<InferredLabel | null>(),
  accepted: text('accepted', { mode: 'json' }).$type<AcceptedLabel>().notNull(),
  provenanceId: text('provenance_id'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [uniqueIndex('labels_segment_key_unique').on(t.segmentId, t.key), index('labels_team_idx').on(t.teamId)]);

export const labelRevisions = sqliteTable('label_revisions', {
  id: text('id').primaryKey(),
  labelId: text('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
  previousValue: text('previous_value'),
  newValue: text('new_value'),
  previousStatus: text('previous_status').notNull(),
  newStatus: text('new_status').notNull(),
  byUserId: text('by_user_id').notNull().references(() => users.id),
  at: text('at').notNull(),
  reason: text('reason'),
}, (t) => [index('label_revisions_label_idx').on(t.labelId)]);

export const modelProvenance = sqliteTable('model_provenance', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
  segmentId: text('segment_id'),
  jobId: text('job_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  modelRevision: text('model_revision'),
  promptId: text('prompt_id').notNull(),
  promptHash: text('prompt_hash').notNull(),
  preprocessing: text('preprocessing', { mode: 'json' }).$type<ModelProvenance['preprocessing']>().notNull(),
  inspected: text('inspected', { mode: 'json' }).$type<ModelProvenance['inspected']>().notNull(),
  analysisVersion: text('analysis_version').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  requestedAt: text('requested_at').notNull(),
  completedAt: text('completed_at').notNull(),
}, (t) => [index('model_provenance_team_completed_idx').on(t.teamId, t.completedAt), index('model_provenance_asset_idx').on(t.assetId)]);

export const reportSnapshots = sqliteTable('report_snapshots', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  opponentId: text('opponent_id').notNull().references(() => opponents.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  findings: text('findings', { mode: 'json' }).$type<ScoutingFinding[]>().notNull(),
  generatedBy: text('generated_by').notNull().references(() => users.id),
  generatedAt: text('generated_at').notNull(),
  inputsHash: text('inputs_hash').notNull(),
}, (t) => [index('report_snapshots_team_opponent_idx').on(t.teamId, t.opponentId)]);

export const teamSettings = sqliteTable('team_settings', {
  teamId: text('team_id').primaryKey().references(() => teams.id, { onDelete: 'cascade' }),
  /** Null = keep originals and proxies until the head coach deletes them (owner decision 2026-10-25). */
  retentionDays: integer('retention_days'),
  version: integer('version').notNull().default(1),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at').notNull(),
});
