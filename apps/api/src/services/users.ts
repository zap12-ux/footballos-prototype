import { and, eq, isNull } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { passwordRecoveryTokens, recoveryCodes, staffMemberships, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { newRecoveryCode, newToken, normalizeRecoveryCode, tokenHash } from '../auth/tokens.js';
import { newTotpSecret, totpUri, verifyTotp } from '../auth/totp.js';
import { revokeAllSessions } from '../auth/session.js';
import { writeAudit } from './audit.js';

export type UserRow = typeof users.$inferSelect;

export function findUserByEmail(ctx: AppContext, email: string): UserRow | undefined {
  return ctx.db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).get();
}

export function getUser(ctx: AppContext, id: string): UserRow | undefined {
  return ctx.db.select().from(users).where(eq(users.id, id)).get();
}

export async function createUser(ctx: AppContext, input: { email: string; displayName: string; password: string }): Promise<UserRow> {
  const now = ctx.now().toISOString();
  const row: UserRow = {
    id: crypto.randomUUID(),
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName,
    passwordHash: await hashPassword(input.password),
    mfaEnabled: false,
    mfaSecret: null,
    mfaPendingSecret: null,
    createdAt: now,
    updatedAt: now,
  };
  ctx.db.insert(users).values(row).run();
  return row;
}

// A fixed hash so unknown e-mails cost the same as a wrong password (no user enumeration by timing).
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  dummyHash ??= await hashPassword(crypto.randomUUID());
  return dummyHash;
}

export async function checkPassword(ctx: AppContext, email: string, password: string): Promise<UserRow | null> {
  const user = findUserByEmail(ctx, email);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  return ok && user ? user : null;
}

export async function setPassword(ctx: AppContext, userId: string, password: string): Promise<void> {
  ctx.db.update(users).set({ passwordHash: await hashPassword(password), updatedAt: ctx.now().toISOString() }).where(eq(users.id, userId)).run();
}

// MFA ----------------------------------------------------------------------------------------

export function beginMfaEnrollment(ctx: AppContext, user: UserRow): { secret: string; otpauthUrl: string } {
  const secret = newTotpSecret();
  ctx.db.update(users).set({ mfaPendingSecret: secret, updatedAt: ctx.now().toISOString() }).where(eq(users.id, user.id)).run();
  return { secret, otpauthUrl: totpUri(user.email, secret) };
}

export function issueRecoveryCodes(ctx: AppContext, userId: string): string[] {
  const now = ctx.now().toISOString();
  ctx.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId)).run();
  const codes = Array.from({ length: 10 }, () => newRecoveryCode());
  ctx.db
    .insert(recoveryCodes)
    .values(codes.map((c) => ({ id: crypto.randomUUID(), userId, codeHash: tokenHash(ctx.config.sessionSecret, normalizeRecoveryCode(c)), usedAt: null, createdAt: now })))
    .run();
  return codes;
}

/** Completes enrollment when `code` matches the pending secret. Returns the recovery codes once. */
export function confirmMfaEnrollment(ctx: AppContext, user: UserRow, code: string, actorTeamIds: string[]): string[] | null {
  if (!user.mfaPendingSecret || !verifyTotp(code, user.mfaPendingSecret)) return null;
  ctx.db
    .update(users)
    .set({ mfaEnabled: true, mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null, updatedAt: ctx.now().toISOString() })
    .where(eq(users.id, user.id))
    .run();
  const codes = issueRecoveryCodes(ctx, user.id);
  for (const teamId of actorTeamIds) writeAudit(ctx, { teamId, actorUserId: user.id, action: 'mfa.enrolled', targetType: 'user', targetId: user.id });
  return codes;
}

/** Verifies a TOTP code or consumes a recovery code. */
export function verifyMfaCode(ctx: AppContext, user: UserRow, code: string): 'totp' | 'recovery' | null {
  if (!user.mfaEnabled || !user.mfaSecret) return null;
  if (verifyTotp(code, user.mfaSecret)) return 'totp';
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length < 8) return null;
  const hash = tokenHash(ctx.config.sessionSecret, normalized);
  const row = ctx.db
    .select()
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, user.id), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)))
    .get();
  if (!row) return null;
  ctx.db.update(recoveryCodes).set({ usedAt: ctx.now().toISOString() }).where(eq(recoveryCodes.id, row.id)).run();
  return 'recovery';
}

/** Demo seed / bootstrap helper: enroll directly with a known secret (no pending step). */
export function enrollMfaDirect(ctx: AppContext, userId: string, secret: string): string[] {
  ctx.db.update(users).set({ mfaEnabled: true, mfaSecret: secret, mfaPendingSecret: null, updatedAt: ctx.now().toISOString() }).where(eq(users.id, userId)).run();
  return issueRecoveryCodes(ctx, userId);
}

// Account recovery -----------------------------------------------------------------------------

/** Creates a recovery token for the user. The raw token is returned to the caller for delivery. */
export function createRecoveryToken(ctx: AppContext, userId: string): string {
  const token = newToken(32);
  const now = ctx.now();
  ctx.db
    .insert(passwordRecoveryTokens)
    .values({
      id: crypto.randomUUID(),
      userId,
      tokenHash: tokenHash(ctx.config.sessionSecret, token),
      expiresAt: new Date(now.getTime() + ctx.config.recoveryTokenTtlMinutes * 60_000).toISOString(),
      usedAt: null,
      createdAt: now.toISOString(),
    })
    .run();
  return token;
}

export async function completeRecovery(ctx: AppContext, token: string, newPassword: string): Promise<UserRow> {
  const row = ctx.db.select().from(passwordRecoveryTokens).where(eq(passwordRecoveryTokens.tokenHash, tokenHash(ctx.config.sessionSecret, token))).get();
  const now = ctx.now();
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= now.getTime()) throw errors.notFound('Recovery token');
  const user = getUser(ctx, row.userId);
  if (!user) throw errors.notFound('Recovery token');
  ctx.db.update(passwordRecoveryTokens).set({ usedAt: now.toISOString() }).where(eq(passwordRecoveryTokens.id, row.id)).run();
  await setPassword(ctx, user.id, newPassword);
  revokeAllSessions(ctx, user.id);
  const teams = ctx.db.select({ teamId: staffMemberships.teamId }).from(staffMemberships).where(eq(staffMemberships.userId, user.id)).all();
  for (const t of teams) writeAudit(ctx, { teamId: t.teamId, actorUserId: user.id, action: 'recovery.completed', targetType: 'user', targetId: user.id });
  return user;
}
