import fs from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { z } from 'zod';
import { CreateUploadRequestSchema, IdSchema, UploadCompleteRequestSchema, type CreateUploadResponse, type UploadCompleteResponse } from '@footballos/contracts';
import { thumbTileJpeg } from '@footballos/media';
import type { AppContext } from '../context.js';
import { ApiError, errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { getGame } from '../services/schedule.js';
import {
  appendChunk, completeUpload, createUpload, deleteAsset, getAsset, listAssetsForGame, parseContentRange, requireAsset, requireLiveUpload, serializeAsset, serializeUpload,
} from '../services/media.js';
import { serializeJob } from '../services/jobs.js';
import { createGrant, verifyGrant } from '../services/grants.js';
import { absolutePath } from '../services/storage.js';

const gameParam = z.object({ gameId: IdSchema });
const uploadParam = z.object({ uploadId: IdSchema });
const assetParam = z.object({ assetId: IdSchema });

export function teamIdsOf(auth: AppEnv['Variables']['auth']): string[] {
  return auth.memberships.filter((m) => m.active).map((m) => m.teamId);
}

function requireGameForTeam(ctx: AppContext, auth: AppEnv['Variables']['auth'], gameId: string) {
  const game = getGame(ctx, gameId);
  if (!game || !teamIdsOf(auth).includes(game.teamId)) throw errors.notFound('Game');
  const membership = requireMembership(auth, game.teamId);
  return { game, membership };
}

/** §14.1 uploads and assets, §14.3 grants (authenticated). */
export function mediaRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    .post('/games/:gameId/uploads', zv('param', gameParam), zv('json', CreateUploadRequestSchema), (c) => {
      const { gameId } = c.req.valid('param');
      const { game, membership } = requireGameForTeam(ctx, c.var.auth, gameId);
      assert(policy.canUploadOrCorrect(membership), 'Viewers cannot upload film');
      const r = createUpload(ctx, c.var.auth.user.id, game.teamId, game.id, c.req.valid('json'));
      const body: CreateUploadResponse = { upload: serializeUpload(r.upload), asset: serializeAsset(r.asset) };
      return c.json(body, 201);
    })
    .get('/uploads/:uploadId', zv('param', uploadParam), (c) => {
      const { uploadId } = c.req.valid('param');
      const u = requireLiveUpload(ctx, uploadId, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, u.teamId);
      return c.json({ upload: serializeUpload(u) }, 200);
    })
    .put('/uploads/:uploadId', zv('param', uploadParam), async (c) => {
      const { uploadId } = c.req.valid('param');
      const u = requireLiveUpload(ctx, uploadId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, u.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot upload film');
      const range = parseContentRange(c.req.header('content-range'));
      if (!range) throw errors.validation('Content-Range header of the form "bytes <start>-<end>/<total>" is required');
      const declared = Number(c.req.header('content-length') ?? '0');
      if (declared > ctx.config.limits.uploadChunkBytes || range.end - range.start + 1 > ctx.config.limits.uploadChunkBytes) {
        throw new ApiError('payload_too_large', `Chunks are limited to ${ctx.config.limits.uploadChunkBytes} bytes`, { uploadChunkBytes: ctx.config.limits.uploadChunkBytes });
      }
      const body = Buffer.from(await c.req.arrayBuffer());
      if (body.length > ctx.config.limits.uploadChunkBytes) {
        throw new ApiError('payload_too_large', `Chunks are limited to ${ctx.config.limits.uploadChunkBytes} bytes`, { uploadChunkBytes: ctx.config.limits.uploadChunkBytes });
      }
      const receivedBytes = appendChunk(ctx, u, range, body);
      return c.json({ receivedBytes }, 200);
    })
    .post('/uploads/:uploadId/complete', zv('param', uploadParam), zv('json', UploadCompleteRequestSchema.optional().default({})), async (c) => {
      const { uploadId } = c.req.valid('param');
      const u = requireLiveUpload(ctx, uploadId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, u.teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot upload film');
      const r = await completeUpload(ctx, c.var.auth.user.id, u, c.req.valid('json').sha256);
      const body: UploadCompleteResponse = { asset: serializeAsset(r.asset), jobs: r.jobs.map(serializeJob) };
      return c.json(body, 200);
    })
    .get('/games/:gameId/assets', zv('param', gameParam), (c) => {
      const { gameId } = c.req.valid('param');
      const { game } = requireGameForTeam(ctx, c.var.auth, gameId);
      return c.json({ items: listAssetsForGame(ctx, game.teamId, game.id).map(serializeAsset) }, 200);
    })
    .get('/assets/:assetId', zv('param', assetParam), (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, a.teamId);
      return c.json({ asset: serializeAsset(a) }, 200);
    })
    .delete('/assets/:assetId', zv('param', assetParam), (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, a.teamId);
      assert(policy.canManageTeam(m), 'Only the head coach deletes film');
      if (a.status !== 'deleted') deleteAsset(ctx, c.var.auth.user.id, a, 'asset.deleted');
      return c.body(null, 204);
    })
    .get('/assets/:assetId/grant', zv('param', assetParam), (c) => {
      const { assetId } = c.req.valid('param');
      const a = requireAsset(ctx, assetId, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, a.teamId);
      if (a.status === 'deleted') throw errors.notFound('Asset');
      return c.json(createGrant(ctx, a.teamId, a.id), 200);
    });
}

const streamParam = z.object({ assetId: IdSchema });
const thumbParam = z.object({ assetId: IdSchema, n: z.coerce.number().int().min(0) });
const tokenQuery = z.object({ token: z.string().min(1).optional() });

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  if (m[1] === '' && m[2] === '') return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') { // suffix: last N bytes
    const n = Number(m[2]);
    if (n === 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

/** §14.3 byte delivery: token-authenticated, no session, HTTP Range on the proxy (or the original). */
export function mediaStreamRoutes(ctx: AppContext) {
  return new Hono()
    .get('/media/:assetId/stream', zv('param', streamParam), zv('query', tokenQuery), (c) => {
      const { assetId } = c.req.valid('param');
      const claims = verifyGrant(ctx, c.req.valid('query').token, assetId);
      if (!claims) throw errors.unauthorized('Media grant is missing, invalid or expired');
      const a = getAsset(ctx, assetId);
      if (!a || a.teamId !== claims.teamId || a.status === 'deleted') throw errors.notFound('Asset');
      const key = a.proxyStorageKey ?? a.storageKey;
      const file = absolutePath(ctx.config, key);
      if (!fs.existsSync(file)) throw errors.notFound('Media file');
      const size = fs.statSync(file).size;
      const contentType = a.proxyStorageKey ? 'video/mp4' : a.mimeType;
      const range = parseRange(c.req.header('range'), size);
      if (range === 'invalid') {
        return c.body(null, 416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Cache-Control': 'private, no-store',
      };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      return c.body(stream, range ? 206 : 200, headers);
    })
    .get('/media/:assetId/thumb/:n', zv('param', thumbParam), zv('query', tokenQuery), async (c) => {
      const { assetId, n } = c.req.valid('param');
      const claims = verifyGrant(ctx, c.req.valid('query').token, assetId);
      if (!claims) throw errors.unauthorized('Media grant is missing, invalid or expired');
      const a = getAsset(ctx, assetId);
      if (!a || a.teamId !== claims.teamId || a.status === 'deleted') throw errors.notFound('Asset');
      if (!a.thumbnailSheetKey) throw errors.notFound('Thumbnails');
      const sheet = absolutePath(ctx.config, a.thumbnailSheetKey);
      if (!fs.existsSync(sheet)) throw errors.notFound('Thumbnails');
      let jpeg: Buffer;
      try {
        jpeg = (await thumbTileJpeg(sheet, n)).jpeg;
      } catch (err) {
        if (err instanceof RangeError) throw errors.notFound('Thumbnail');
        throw err;
      }
      return c.body(new Uint8Array(jpeg), 200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(jpeg.length), 'Cache-Control': 'private, no-store' });
    });
}
