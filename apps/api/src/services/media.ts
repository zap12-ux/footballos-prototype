import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { and, asc, eq, inArray, isNull, lt, ne } from 'drizzle-orm';
import { sanitizeFilename, type CreateUploadRequest, type MediaAsset, type Upload } from '@footballos/contracts';
import type { Job } from '@footballos/media';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { mediaAssets, playSegments, playbookDocuments, processingJobs, teamSettings, uploads } from '../db/schema.js';
import { coachingLibs } from '../libs/index.js';
import { ApiError, errors } from '../errors.js';
import { enqueueJob } from '../jobs/enqueue.js';
import { writeAudit } from './audit.js';
import {
  absolutePath, assetDirKey, createPrivateFile, ensureAssetDir, extensionOf, originalKey, partPath, removeQuietly, FILE_MODE,
} from './storage.js';

export type AssetRow = typeof mediaAssets.$inferSelect;
export type UploadRow = typeof uploads.$inferSelect;
export type DocumentRow = typeof playbookDocuments.$inferSelect;

/** Film is always game-bound; only playbook documents have a null gameId (§15.1). */
export function filmGameId(asset: Pick<AssetRow, 'id' | 'kind' | 'gameId'>): string {
  if (asset.gameId === null) throw errors.conflict(`Asset ${asset.id} is a ${asset.kind} without a game`, { reason: 'not_film' });
  return asset.gameId;
}

/** Bump when the document extraction or proposal outputs change shape; part of the extract_document idempotency key. */
export const DOCUMENT_EXTRACT_KIND = 'extract_document';

export function documentConfigVersion(ctx: AppContext): string {
  return `doc-extract-1:${coachingLibs.version}:dpi${ctx.config.limits.documentRenderDpi}:ocr-${ctx.config.limits.documentOcr}`;
}

/** `ProcessingJob.input` of an extract_document job: C's DocumentJobInput plus identity. */
export type DocumentJobInput = { assetId: string; sourcePath: string; outDir: string; teamId: string; documentId: string };

/** The upload context stored for a document: it describes our own unit, nothing is analyzed from film. */
export function documentContext(unit: 'offense' | 'defense' | 'special_teams'): AssetRow['context'] {
  return { analyzedTeam: 'us', analyzedUnit: unit, perspective: 'other', teamCues: null };
}

function titleFromFilename(filename: string): string {
  const stem = filename.replace(/\.[A-Za-z0-9]{1,8}$/, '').replace(/[_]+/g, ' ').trim();
  return (stem || filename).slice(0, 200);
}

/** Bump when the media chain's outputs change shape; part of every chain job's idempotency key. */
export const MEDIA_CHAIN_VERSION = 'media-chain-1';
export const CHAIN_KINDS = ['validate', 'proxy', 'thumbnails', 'segment'] as const;

export function chainConfigVersion(ctx: AppContext): string {
  return `${MEDIA_CHAIN_VERSION}:proxy${ctx.config.limits.proxyHeight}:thumb${ctx.config.limits.thumbnailEverySec}`;
}

// Serialization ---------------------------------------------------------------------------------

export function serializeAsset(a: AssetRow): MediaAsset {
  return {
    id: a.id, teamId: a.teamId, gameId: a.gameId, uploadedBy: a.uploadedBy, kind: a.kind as MediaAsset['kind'],
    originalFilename: a.originalFilename, byteSize: a.byteSize, sha256: a.sha256, mimeType: a.mimeType,
    durationSec: a.durationSec, width: a.width, height: a.height, fps: a.fps, status: a.status as MediaAsset['status'],
    rejectionReason: a.rejectionReason, context: a.context, quality: a.quality ?? null, storageKey: a.storageKey,
    proxyStorageKey: a.proxyStorageKey, thumbnailSheetKey: a.thumbnailSheetKey, retentionUntil: a.retentionUntil,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

export function serializeUpload(u: UploadRow): Upload {
  return {
    id: u.id, assetId: u.assetId, teamId: u.teamId, chunkSizeBytes: u.chunkSizeBytes, receivedBytes: u.receivedBytes,
    totalBytes: u.totalBytes, expiresAt: u.expiresAt, completedAt: u.completedAt,
  };
}

// Lookups ---------------------------------------------------------------------------------------

export function getAsset(ctx: AppContext, assetId: string): AssetRow | undefined {
  return ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).get();
}

/** Team-scoped lookup: a foreign or unknown asset is `404`, never `403`. */
export function requireAsset(ctx: AppContext, assetId: string, teamIds: string[]): AssetRow {
  const a = getAsset(ctx, assetId);
  if (!a || !teamIds.includes(a.teamId)) throw errors.notFound('Asset');
  return a;
}

export function listAssetsForGame(ctx: AppContext, teamId: string, gameId: string): AssetRow[] {
  return ctx.db.select().from(mediaAssets).where(and(eq(mediaAssets.teamId, teamId), eq(mediaAssets.gameId, gameId))).orderBy(asc(mediaAssets.createdAt)).all();
}

export function getUpload(ctx: AppContext, uploadId: string): UploadRow | undefined {
  return ctx.db.select().from(uploads).where(eq(uploads.id, uploadId)).get();
}

function findDuplicate(ctx: AppContext, teamId: string, sha256: string, exceptAssetId?: string): AssetRow | undefined {
  const rows = ctx.db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.teamId, teamId), eq(mediaAssets.sha256, sha256), ne(mediaAssets.status, 'deleted')))
    .all();
  return rows.find((r) => r.id !== exceptAssetId);
}

function retentionUntilFor(ctx: AppContext, teamId: string, createdAtIso: string): string | null {
  const s = ctx.db.select().from(teamSettings).where(eq(teamSettings.teamId, teamId)).get();
  if (!s || s.retentionDays === null) return null;
  return new Date(new Date(createdAtIso).getTime() + s.retentionDays * 86_400_000).toISOString();
}

// §14.1 Create ----------------------------------------------------------------------------------

export function createUpload(ctx: AppContext, userId: string, teamId: string, gameId: string | null, input: CreateUploadRequest): { upload: UploadRow; asset: AssetRow; document: DocumentRow | null } {
  const limits = ctx.config.limits;
  const isDocument = input.kind === 'document';
  if (!isDocument && gameId === null) throw errors.validation('Film uploads belong to a game');
  const maxBytes = isDocument ? limits.maxDocumentBytes : limits.maxUploadBytes;
  if (input.byteSize > maxBytes) {
    throw new ApiError('payload_too_large', `File is larger than the ${maxBytes} byte limit`, { maxUploadBytes: maxBytes });
  }
  // The route's validator already sanitized the name (§14.10, QA D-7); callers that bypass it get the same rule.
  const filename = sanitizeFilename(input.filename);
  if (filename === null) throw errors.validation('filename must be 1-255 characters with a name before the extension and no control characters');
  const ext = extensionOf(filename);
  const allowed = isDocument ? limits.allowedDocumentTypes : limits.allowedVideoContainers;
  if (!ext || !allowed.includes(ext)) {
    throw errors.validation(`Unsupported file type; allowed: ${allowed.join(', ')}`, isDocument ? { allowedDocumentTypes: allowed } : { allowedVideoContainers: allowed });
  }
  if (input.sha256) {
    const dup = findDuplicate(ctx, teamId, input.sha256);
    if (dup) throw errors.conflict('This file was already uploaded to this team', { existingAssetId: dup.id });
  }
  let context: AssetRow['context'];
  if (isDocument) {
    if (!input.unit) throw errors.validation('unit is required for a document upload');
    context = documentContext(input.unit);
  } else {
    if (!input.context) throw errors.validation('context is required for film uploads');
    context = input.context;
  }
  const now = ctx.now();
  const nowIso = now.toISOString();
  const assetId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const asset: AssetRow = {
    id: assetId, teamId, gameId, uploadedBy: userId, kind: input.kind, originalFilename: filename, byteSize: input.byteSize,
    sha256: null, mimeType: input.mimeType, durationSec: null, width: null, height: null, fps: null, container: null, status: 'uploading',
    rejectionReason: null, context, quality: null, storageKey: originalKey(teamId, assetId, ext), proxyStorageKey: null,
    thumbnailSheetKey: null, retentionUntil: isDocument ? null : retentionUntilFor(ctx, teamId, nowIso), createdAt: nowIso, updatedAt: nowIso,
  };
  const upload: UploadRow = {
    id: uploadId, assetId, teamId, chunkSizeBytes: limits.uploadChunkBytes, receivedBytes: 0, totalBytes: input.byteSize,
    expectedSha256: input.sha256 ?? null, expiresAt: new Date(now.getTime() + limits.uploadTtlHours * 3_600_000).toISOString(),
    completedAt: null, createdAt: nowIso,
  };
  const document: DocumentRow | null = isDocument
    ? {
        id: crypto.randomUUID(), teamId, unit: input.unit!, title: input.title ?? titleFromFilename(filename), assetId, pageCount: 0, status: 'uploaded',
        extraction: null, createdBy: userId, createdAt: nowIso, updatedAt: nowIso,
      }
    : null;
  ctx.db.transaction((tx) => {
    tx.insert(mediaAssets).values(asset).run();
    tx.insert(uploads).values(upload).run();
    if (document) tx.insert(playbookDocuments).values(document).run();
  });
  createPrivateFile(partPath(ctx.config, uploadId));
  return { upload, asset, document };
}

// §14.1 PUT range -------------------------------------------------------------------------------

export type ContentRange = { start: number; end: number; total: number };

export function parseContentRange(header: string | undefined): ContentRange | null {
  if (!header) return null;
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header.trim());
  if (!m) return null;
  const r = { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) };
  if (!Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || !Number.isSafeInteger(r.total)) return null;
  if (r.end < r.start || r.end >= r.total) return null;
  return r;
}

/** Live (not completed, not expired) upload or 404. */
export function requireLiveUpload(ctx: AppContext, uploadId: string, teamIds: string[]): UploadRow {
  const u = getUpload(ctx, uploadId);
  if (!u || !teamIds.includes(u.teamId)) throw errors.notFound('Upload');
  if (u.expiresAt <= ctx.now().toISOString() && u.completedAt === null) throw errors.notFound('Upload (expired)');
  return u;
}

export function appendChunk(ctx: AppContext, upload: UploadRow, range: ContentRange, body: Buffer): number {
  if (upload.completedAt) throw errors.conflict('Upload already completed', { receivedBytes: upload.receivedBytes });
  if (range.total !== upload.totalBytes) throw errors.validation(`Content-Range total ${range.total} does not match the declared size ${upload.totalBytes}`);
  if (body.length !== range.end - range.start + 1) throw errors.validation(`Body length ${body.length} does not match Content-Range ${range.start}-${range.end}`);
  if (range.start !== upload.receivedBytes) {
    throw errors.conflict(`Chunks must be contiguous; next expected byte is ${upload.receivedBytes}`, { receivedBytes: upload.receivedBytes });
  }
  const file = partPath(ctx.config, upload.id);
  if (!fs.existsSync(file)) createPrivateFile(file);
  const fd = fs.openSync(file, 'r+', FILE_MODE);
  try {
    let written = 0;
    while (written < body.length) written += fs.writeSync(fd, body, written, body.length - written, range.start + written);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const received = range.end + 1;
  ctx.db.update(uploads).set({ receivedBytes: received }).where(eq(uploads.id, upload.id)).run();
  return received;
}

// §14.1 Complete --------------------------------------------------------------------------------

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function discardUpload(ctx: AppContext, upload: UploadRow): void {
  removeQuietly(partPath(ctx.config, upload.id));
  ctx.db.transaction((tx) => {
    tx.delete(uploads).where(eq(uploads.id, upload.id)).run();
    tx.delete(mediaAssets).where(and(eq(mediaAssets.id, upload.assetId), eq(mediaAssets.status, 'uploading'))).run();
  });
}

export async function completeUpload(ctx: AppContext, userId: string, upload: UploadRow, clientSha256: string | undefined): Promise<{ asset: AssetRow; jobs: Job[] }> {
  const asset = getAsset(ctx, upload.assetId);
  if (!asset) throw errors.notFound('Asset');
  if (upload.completedAt) {
    return { asset, jobs: await listChainJobs(ctx, asset.id) };
  }
  if (upload.receivedBytes !== upload.totalBytes) {
    throw errors.conflict(`Upload is incomplete: ${upload.receivedBytes} of ${upload.totalBytes} bytes received`, { receivedBytes: upload.receivedBytes });
  }
  const part = partPath(ctx.config, upload.id);
  if (!fs.existsSync(part)) throw errors.notFound('Upload (partial file missing)');
  const actual = await sha256File(part);
  const expected = clientSha256 ?? upload.expectedSha256;
  if (expected && expected !== actual) {
    discardUpload(ctx, upload);
    throw errors.validation('The stored bytes do not match the declared sha256; upload again', { expectedSha256: expected, actualSha256: actual });
  }
  const dup = findDuplicate(ctx, asset.teamId, actual, asset.id);
  if (dup) {
    discardUpload(ctx, upload);
    throw errors.conflict('This file was already uploaded to this team', { existingAssetId: dup.id });
  }
  ensureAssetDir(ctx.config, asset.teamId, asset.id);
  const dest = absolutePath(ctx.config, asset.storageKey);
  fs.renameSync(part, dest);
  try { fs.chmodSync(dest, FILE_MODE); } catch { /* ignore */ }
  const nowIso = ctx.now().toISOString();
  ctx.db.transaction((tx) => {
    tx.update(mediaAssets).set({ status: 'uploaded', sha256: actual, byteSize: upload.totalBytes, updatedAt: nowIso }).where(eq(mediaAssets.id, asset.id)).run();
    tx.update(uploads).set({ completedAt: nowIso }).where(eq(uploads.id, upload.id)).run();
  });
  const updated = getAsset(ctx, asset.id)!;
  const jobs = updated.kind === 'document' ? [await enqueueDocumentExtraction(ctx, updated, userId)] : await enqueueProcessingChain(ctx, updated, userId);
  return { asset: updated, jobs };
}

/** §15.1: one `extract_document` job per document, idempotent per sha256 + config version. */
export async function enqueueDocumentExtraction(ctx: AppContext, asset: AssetRow, requestedBy: string): Promise<Job> {
  const doc = ctx.db.select().from(playbookDocuments).where(eq(playbookDocuments.assetId, asset.id)).get();
  if (!doc) throw errors.notFound('Playbook document');
  const outDir = absolutePath(ctx.config, assetDirKey(asset.teamId, asset.id));
  const input: DocumentJobInput = { assetId: asset.id, teamId: asset.teamId, documentId: doc.id, sourcePath: absolutePath(ctx.config, asset.storageKey), outDir };
  const { job } = await enqueueJob(ctx, {
    teamId: asset.teamId, assetId: asset.id, kind: DOCUMENT_EXTRACT_KIND, input, requestedBy, keyInputs: { assetId: asset.id, sha256: asset.sha256 }, configVersion: documentConfigVersion(ctx),
  });
  ctx.db.update(playbookDocuments).set({ status: 'extracting', updatedAt: ctx.now().toISOString() }).where(and(eq(playbookDocuments.id, doc.id), eq(playbookDocuments.status, 'uploaded'))).run();
  return job;
}

/** validate → proxy → thumbnails → segment, each idempotent by sha256(kind + assetId + configVersion). */
export async function enqueueProcessingChain(ctx: AppContext, asset: AssetRow, requestedBy: string): Promise<Job[]> {
  const configVersion = chainConfigVersion(ctx);
  const outDir = absolutePath(ctx.config, assetDirKey(asset.teamId, asset.id));
  const input = { assetId: asset.id, teamId: asset.teamId, gameId: asset.gameId, sourcePath: absolutePath(ctx.config, asset.storageKey), outDir };
  const jobs: Job[] = [];
  let previous: Job | null = null;
  for (const kind of CHAIN_KINDS) {
    const { job } = await enqueueJob(ctx, {
      teamId: asset.teamId, assetId: asset.id, kind, input, requestedBy, keyInputs: { assetId: asset.id }, configVersion, dependsOnJobId: previous?.id ?? null,
    });
    jobs.push(job);
    previous = job;
  }
  return jobs;
}

async function listChainJobs(ctx: AppContext, assetId: string): Promise<Job[]> {
  const all = await ctx.jobStore.list();
  return all.filter((j) => j.assetId === assetId && ((CHAIN_KINDS as readonly string[]).includes(j.kind) || j.kind === DOCUMENT_EXTRACT_KIND));
}

// §14.1 Delete (retention action) ----------------------------------------------------------------

export function deleteAssetFiles(ctx: AppContext, asset: AssetRow): void {
  removeQuietly(absolutePath(ctx.config, assetDirKey(asset.teamId, asset.id)));
}

/** Head-coach retention action: files are hard-deleted, the record stays as `deleted`, an audit row is written. */
export function deleteAsset(ctx: AppContext, actorUserId: string | null, asset: AssetRow, action: 'asset.deleted' | 'retention.applied'): void {
  const now = ctx.now();
  ctx.db.transaction((tx) => {
    ctx.jobStore.cancelForAsset(tx, asset.id, now);
    tx.update(mediaAssets)
      .set({ status: 'deleted', proxyStorageKey: null, thumbnailSheetKey: null, updatedAt: now.toISOString() })
      .where(eq(mediaAssets.id, asset.id))
      .run();
    tx.delete(uploads).where(and(eq(uploads.assetId, asset.id), isNull(uploads.completedAt))).run();
  });
  deleteAssetFiles(ctx, asset);
  for (const u of ctx.db.select().from(uploads).where(eq(uploads.assetId, asset.id)).all()) removeQuietly(partPath(ctx.config, u.id));
  writeAudit(ctx, {
    teamId: asset.teamId, actorUserId, action, targetType: 'media_asset', targetId: asset.id,
    details: { originalFilename: asset.originalFilename, byteSize: asset.byteSize, previousStatus: asset.status },
  });
}

// Maintenance (worker tick) ---------------------------------------------------------------------

/** Removes expired, incomplete uploads with their partial files and placeholder assets. */
export function gcExpiredUploads(ctx: AppContext): number {
  const nowIso = ctx.now().toISOString();
  const expired = ctx.db.select().from(uploads).where(and(isNull(uploads.completedAt), lt(uploads.expiresAt, nowIso))).all();
  for (const u of expired) {
    removeQuietly(partPath(ctx.config, u.id));
    ctx.db.transaction((tx) => {
      tx.delete(uploads).where(eq(uploads.id, u.id)).run();
      tx.delete(mediaAssets).where(and(eq(mediaAssets.id, u.assetId), eq(mediaAssets.status, 'uploading'))).run();
    });
    writeAudit(ctx, { teamId: u.teamId, actorUserId: null, action: 'upload.expired', targetType: 'upload', targetId: u.id, details: { receivedBytes: u.receivedBytes, totalBytes: u.totalBytes } });
  }
  return expired.length;
}

/** Deletes originals and proxies past `team_settings.retentionDays`; a null setting keeps everything (owner decision 2026-10-25). */
export function applyRetention(ctx: AppContext): number {
  const nowIso = ctx.now().toISOString();
  const due = ctx.db
    .select()
    .from(mediaAssets)
    .where(and(ne(mediaAssets.status, 'deleted'), ne(mediaAssets.status, 'uploading'), lt(mediaAssets.retentionUntil, nowIso)))
    .all();
  for (const a of due) deleteAsset(ctx, null, a, 'retention.applied');
  return due.length;
}

/** Recomputes `retentionUntil` for every live asset of a team after the setting changed. */
export function recomputeRetention(tx: Db, teamId: string, retentionDays: number | null, nowIso: string): void {
  const rows = tx.select().from(mediaAssets).where(and(eq(mediaAssets.teamId, teamId), ne(mediaAssets.status, 'deleted'))).all();
  for (const a of rows) {
    const until = retentionDays === null ? null : new Date(new Date(a.createdAt).getTime() + retentionDays * 86_400_000).toISOString();
    tx.update(mediaAssets).set({ retentionUntil: until, updatedAt: nowIso }).where(eq(mediaAssets.id, a.id)).run();
  }
}

/** Live segment ids of an asset (helper shared with routes). */
export function liveSegmentIds(ctx: AppContext, assetId: string): string[] {
  return ctx.db.select({ id: playSegments.id, supersededBy: playSegments.supersededBy }).from(playSegments).where(eq(playSegments.assetId, assetId)).all()
    .filter((s) => s.supersededBy.length === 0).map((s) => s.id);
}

export function pendingJobsForAsset(ctx: AppContext, assetId: string) {
  return ctx.db.select().from(processingJobs).where(and(eq(processingJobs.assetId, assetId), inArray(processingJobs.status, ['queued', 'running', 'retry_wait']))).all();
}

