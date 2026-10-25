import { hmacHex, safeEqualHex } from '../auth/tokens.js';
import type { AppContext } from '../context.js';
import { API_PREFIX } from '../http/prefix.js';
import type { MediaGrant } from '@footballos/contracts';

/**
 * Media grants (CONTRACTS §5, §14.3): short-lived HMAC tokens bound to team + asset. Bytes are
 * served only through `/media/:assetId/stream?token=` and `/media/:assetId/thumb/:n?token=`;
 * there are no public object URLs. Token = base64url(teamId.assetId.expMs).signature.
 */

export type GrantClaims = { teamId: string; assetId: string; expiresAtMs: number };

function payload(c: GrantClaims): string {
  return `${c.teamId}.${c.assetId}.${c.expiresAtMs}`;
}

export function signGrant(ctx: AppContext, claims: GrantClaims): string {
  const body = Buffer.from(payload(claims), 'utf8').toString('base64url');
  return `${body}.${hmacHex(ctx.config.sessionSecret, `media-grant:${payload(claims)}`)}`;
}

/** Returns the claims when the token is well-formed, correctly signed, unexpired and bound to `assetId`. */
export function verifyGrant(ctx: AppContext, token: string | undefined, assetId: string): GrantClaims | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  let decoded: string;
  try { decoded = Buffer.from(body, 'base64url').toString('utf8'); } catch { return null; }
  const parts = decoded.split('.');
  if (parts.length !== 3) return null;
  const claims: GrantClaims = { teamId: parts[0]!, assetId: parts[1]!, expiresAtMs: Number(parts[2]) };
  if (!Number.isFinite(claims.expiresAtMs)) return null;
  if (!safeEqualHex(sig, hmacHex(ctx.config.sessionSecret, `media-grant:${payload(claims)}`))) return null;
  if (claims.assetId !== assetId) return null;
  if (ctx.now().getTime() >= claims.expiresAtMs) return null;
  return claims;
}

export function createGrant(ctx: AppContext, teamId: string, assetId: string): MediaGrant {
  const expiresAtMs = ctx.now().getTime() + ctx.config.limits.mediaGrantTtlMin * 60_000;
  const token = signGrant(ctx, { teamId, assetId, expiresAtMs });
  return {
    streamUrl: `${API_PREFIX}/media/${assetId}/stream?token=${encodeURIComponent(token)}`,
    thumbUrlTemplate: `${API_PREFIX}/media/${assetId}/thumb/{n}?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}
