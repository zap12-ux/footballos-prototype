import { and, eq, isNull } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppContext } from '../context.js';
import { sessions, users, staffMemberships } from '../db/schema.js';
import { hmacHex, ipHash, safeEqualHex } from './tokens.js';

export const SESSION_COOKIE = 'fos_session';

export type SessionRow = typeof sessions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type MembershipRow = typeof staffMemberships.$inferSelect;

export type AuthContext = {
  session: SessionRow;
  user: UserRow;
  memberships: MembershipRow[];
};

function sign(ctx: AppContext, sessionId: string): string {
  return `${sessionId}.${hmacHex(ctx.config.sessionSecret, `session:${sessionId}`)}`;
}

function unsign(ctx: AppContext, value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = hmacHex(ctx.config.sessionSecret, `session:${id}`);
  if (!/^[0-9a-f]+$/.test(sig) || !safeEqualHex(sig, expected)) return null;
  return id;
}

export function clientIp(c: Context): string | null {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? null;
}

export function createSession(ctx: AppContext, c: Context, userId: string, mfaVerified: boolean): SessionRow {
  const now = ctx.now();
  const row: SessionRow = {
    id: crypto.randomUUID(),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ctx.config.sessionAbsoluteDays * 86_400_000).toISOString(),
    lastSeenAt: now.toISOString(),
    mfaVerified,
    ipHash: ipHash(ctx.config.sessionSecret, clientIp(c)),
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 200) || null,
    revokedAt: null,
  };
  ctx.db.insert(sessions).values(row).run();
  setCookie(c, SESSION_COOKIE, sign(ctx, row.id), {
    httpOnly: true,
    sameSite: 'Lax',
    secure: ctx.config.cookieSecure,
    path: '/',
    maxAge: ctx.config.sessionAbsoluteDays * 86_400,
  });
  return row;
}

export function clearSessionCookie(c: Context, ctx: AppContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: ctx.config.cookieSecure, sameSite: 'Lax', httpOnly: true });
}

/** Resolves the cookie to a live session (signature, revocation, idle and absolute expiry) and touches lastSeenAt. */
export function resolveSession(ctx: AppContext, c: Context): AuthContext | null {
  const id = unsign(ctx, getCookie(c, SESSION_COOKIE));
  if (!id) return null;
  const session = ctx.db.select().from(sessions).where(and(eq(sessions.id, id), isNull(sessions.revokedAt))).get();
  if (!session) return null;
  const now = ctx.now();
  const idleLimit = new Date(session.lastSeenAt).getTime() + ctx.config.sessionIdleHours * 3_600_000;
  if (now.getTime() >= new Date(session.expiresAt).getTime() || now.getTime() >= idleLimit) {
    ctx.db.update(sessions).set({ revokedAt: now.toISOString() }).where(eq(sessions.id, id)).run();
    return null;
  }
  const user = ctx.db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) return null;
  if (now.getTime() - new Date(session.lastSeenAt).getTime() > 60_000) {
    ctx.db.update(sessions).set({ lastSeenAt: now.toISOString() }).where(eq(sessions.id, id)).run();
    session.lastSeenAt = now.toISOString();
  }
  const memberships = ctx.db
    .select()
    .from(staffMemberships)
    .where(and(eq(staffMemberships.userId, user.id), eq(staffMemberships.active, true)))
    .all();
  return { session, user, memberships };
}

export function revokeSession(ctx: AppContext, sessionId: string): void {
  ctx.db.update(sessions).set({ revokedAt: ctx.now().toISOString() }).where(eq(sessions.id, sessionId)).run();
}

export function revokeAllSessions(ctx: AppContext, userId: string, exceptSessionId?: string): void {
  const now = ctx.now().toISOString();
  const rows = ctx.db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))).all();
  for (const r of rows) if (r.id !== exceptSessionId) ctx.db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, r.id)).run();
}

export function markMfaVerified(ctx: AppContext, sessionId: string): void {
  ctx.db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId)).run();
}
