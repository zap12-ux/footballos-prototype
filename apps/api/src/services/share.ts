import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { SHARE_LINK_MAX_HOURS, type ShareLink } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { shareLinks } from '../db/schema.js';
import { ApiError, errors } from '../errors.js';
import { writeAudit } from './audit.js';
import type { PlanVersionRow } from './plans.js';

export type ShareLinkRow = typeof shareLinks.$inferSelect;

export const serializeShareLink = (s: ShareLinkRow): ShareLink => ({
  id: s.id, teamId: s.teamId, targetType: s.targetType as ShareLink['targetType'], targetId: s.targetId, tokenHash: s.tokenHash, expiresAt: s.expiresAt, createdBy: s.createdBy, revokedAt: s.revokedAt,
});

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * §15.4 share link for an approved plan version. The raw token (32 random bytes, base64url) is
 * returned once; only its sha256 is stored. Lifetime at most 72 h (owner decision 2026-10-25).
 */
export function createShareLink(ctx: AppContext, actorUserId: string, v: PlanVersionRow, expiresInHours: number): { link: ShareLinkRow; token: string; url: string } {
  if (v.status !== 'approved') throw errors.conflict('Only an approved plan version can be shared', { currentStatus: v.status, reason: 'not_approved' });
  const hours = Math.min(expiresInHours, SHARE_LINK_MAX_HOURS);
  const token = randomBytes(32).toString('base64url');
  const now = ctx.now();
  const row: ShareLinkRow = {
    id: crypto.randomUUID(), teamId: v.teamId, targetType: 'plan_version', targetId: v.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    createdBy: actorUserId, createdAt: now.toISOString(), revokedAt: null, revokedBy: null,
  };
  ctx.db.insert(shareLinks).values(row).run();
  writeAudit(ctx, { teamId: v.teamId, actorUserId, action: 'plan.shared', targetType: 'plan_version', targetId: v.id, details: { shareLinkId: row.id, expiresAt: row.expiresAt, hours } });
  return { link: row, token, url: `${ctx.config.publicOrigin}/shared/${token}` };
}

export function getShareLink(ctx: AppContext, id: string): ShareLinkRow | undefined {
  return ctx.db.select().from(shareLinks).where(eq(shareLinks.id, id)).get();
}

/** Resolves a raw token to a live link; expired or revoked → 410 gone, unknown → 404 (never reveals which). */
export function resolveShareToken(ctx: AppContext, token: string): ShareLinkRow {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw errors.notFound('Shared plan');
  const row = ctx.db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hashToken(token))).get();
  if (!row) throw errors.notFound('Shared plan');
  if (row.revokedAt) throw new ApiError('gone', 'This share link was revoked', { reason: 'revoked' });
  if (row.expiresAt <= ctx.now().toISOString()) throw new ApiError('gone', 'This share link has expired', { reason: 'expired', expiresAt: row.expiresAt });
  return row;
}

export function revokeShareLink(ctx: AppContext, actorUserId: string, row: ShareLinkRow): ShareLinkRow {
  if (row.revokedAt) return row;
  const nowIso = ctx.now().toISOString();
  ctx.db.update(shareLinks).set({ revokedAt: nowIso, revokedBy: actorUserId }).where(eq(shareLinks.id, row.id)).run();
  writeAudit(ctx, { teamId: row.teamId, actorUserId, action: 'plan.share_revoked', targetType: row.targetType, targetId: row.targetId, details: { shareLinkId: row.id } });
  return { ...row, revokedAt: nowIso, revokedBy: actorUserId };
}

export function listShareLinks(ctx: AppContext, teamId: string, opts: { activeOnly?: boolean } = {}): ShareLinkRow[] {
  const where = opts.activeOnly ? and(eq(shareLinks.teamId, teamId), isNull(shareLinks.revokedAt)) : eq(shareLinks.teamId, teamId);
  return ctx.db.select().from(shareLinks).where(where).orderBy(asc(shareLinks.createdAt)).all();
}

export function listShareLinksForTarget(ctx: AppContext, targetId: string): ShareLinkRow[] {
  return ctx.db.select().from(shareLinks).where(eq(shareLinks.targetId, targetId)).orderBy(asc(shareLinks.createdAt)).all();
}
