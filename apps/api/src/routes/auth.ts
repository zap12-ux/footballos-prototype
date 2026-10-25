import { Hono } from 'hono';
import { z } from 'zod';
import {
  AcceptInviteRequestSchema, MfaVerifyRequestSchema, RecoveryCompleteRequestSchema, RecoveryRequestSchema, SignInRequestSchema,
  type AuthState, type MfaVerifyResponse,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { mfaState, requireAuth, type AppEnv } from '../http/guards.js';
import { clearSessionCookie, clientIp, createSession, markMfaVerified, resolveSession, revokeSession, type AuthContext } from '../auth/session.js';
import { ipHash } from '../auth/tokens.js';
import { serialize } from '../services/serialize.js';
import { acceptInvite, listTeamsForUser } from '../services/teams.js';
import {
  beginMfaEnrollment, checkPassword, completeRecovery, confirmMfaEnrollment, createRecoveryToken, findUserByEmail, getUser, verifyMfaCode,
} from '../services/users.js';
import { logsRecoveryTokens } from '../config.js';

function authState(ctx: AppContext, auth: AuthContext): AuthState {
  const fresh = getUser(ctx, auth.user.id) ?? auth.user;
  const state = mfaState({ ...auth, user: fresh });
  return {
    user: serialize.user(fresh),
    mfaRequired: state.mfaRequired,
    mfaEnrollmentRequired: state.mfaEnrollmentRequired,
    memberships: listTeamsForUser(ctx, fresh.id).map((t) => serialize.membership(t.membership)),
  };
}

export function authRoutes(ctx: AppContext) {
  const limiterKey = (ip: string | null, suffix: string) => `${ipHash(ctx.config.sessionSecret, ip) ?? 'noip'}|${suffix}`;

  return new Hono<AppEnv>()
    .post('/sign-in', zv('json', SignInRequestSchema), async (c) => {
      const body = c.req.valid('json');
      const key = limiterKey(clientIp(c), body.email);
      const retry = ctx.signInLimiter.check(key);
      if (retry !== null) throw errors.rateLimited(retry);
      const user = await checkPassword(ctx, body.email, body.password);
      if (!user) {
        ctx.signInLimiter.hit(key);
        throw errors.unauthorized('Invalid e-mail or password');
      }
      ctx.signInLimiter.reset(key);
      const session = createSession(ctx, c, user.id, !user.mfaEnabled);
      const memberships = listTeamsForUser(ctx, user.id).map((t) => t.membership);
      return c.json(authState(ctx, { session, user, memberships }), 200);
    })
    .post('/sign-out', async (c) => {
      const auth = resolveSession(ctx, c);
      if (auth) revokeSession(ctx, auth.session.id);
      clearSessionCookie(c, ctx);
      return c.json({ ok: true as const }, 200);
    })
    .get('/me', requireAuth(ctx, { allowMfaPending: true }), (c) => c.json(authState(ctx, c.var.auth), 200))
    .post('/mfa/setup', requireAuth(ctx, { allowMfaPending: true }), (c) => {
      const { user, session } = c.var.auth;
      if (user.mfaEnabled && !session.mfaVerified) throw errors.unauthorized('Verify your current authenticator before re-enrolling', { mfaRequired: true });
      return c.json(beginMfaEnrollment(ctx, user), 200);
    })
    .post('/mfa/verify', requireAuth(ctx, { allowMfaPending: true }), zv('json', MfaVerifyRequestSchema), (c) => {
      const { user, session, memberships } = c.var.auth;
      const key = limiterKey(clientIp(c), `mfa:${user.id}`);
      const retry = ctx.mfaLimiter.check(key);
      if (retry !== null) throw errors.rateLimited(retry);
      const { code } = c.req.valid('json');
      if (!user.mfaEnabled && user.mfaPendingSecret) {
        const codes = confirmMfaEnrollment(ctx, user, code, memberships.map((m) => m.teamId));
        if (!codes) { ctx.mfaLimiter.hit(key); throw errors.unauthorized('Invalid authenticator code', { mfaRequired: true }); }
        markMfaVerified(ctx, session.id);
        ctx.mfaLimiter.reset(key);
        const res: MfaVerifyResponse = { mfaVerified: true, recoveryCodes: codes };
        return c.json(res, 200);
      }
      if (!user.mfaEnabled) throw errors.conflict('No authenticator is enrolled; call /auth/mfa/setup first');
      const how = verifyMfaCode(ctx, user, code);
      if (!how) { ctx.mfaLimiter.hit(key); throw errors.unauthorized('Invalid authenticator or recovery code', { mfaRequired: true }); }
      markMfaVerified(ctx, session.id);
      ctx.mfaLimiter.reset(key);
      const res: MfaVerifyResponse = { mfaVerified: true };
      return c.json(res, 200);
    })
    .post('/invites/:token/accept', zv('param', z.object({ token: z.string().min(16).max(256) })), zv('json', AcceptInviteRequestSchema), async (c) => {
      const { token } = c.req.valid('param');
      const current = resolveSession(ctx, c);
      const { user, createdUser } = await acceptInvite(ctx, token, c.req.valid('json'), current?.user ?? null);
      if (createdUser || !current) {
        const session = createSession(ctx, c, user.id, !user.mfaEnabled);
        return c.json(authState(ctx, { session, user, memberships: [] }), 201);
      }
      return c.json(authState(ctx, current), 200);
    })
    .post('/recovery/request', zv('json', RecoveryRequestSchema), (c) => {
      const { email } = c.req.valid('json');
      const key = limiterKey(clientIp(c), `recovery:${email}`);
      const retry = ctx.signInLimiter.check(key);
      if (retry !== null) throw errors.rateLimited(retry);
      ctx.signInLimiter.hit(key);
      const user = findUserByEmail(ctx, email);
      if (user) {
        const token = createRecoveryToken(ctx, user.id);
        if (logsRecoveryTokens(ctx.config)) {
          // No mail provider is configured. In demo/development environments only, the token is written to the
          // server log so the owner can complete recovery locally. Production never logs it.
          ctx.logger.warn('account recovery token issued (demo/development only; no mail provider configured)', {
            userId: user.id,
            unredacted_recovery_token: token,
            expiresInMinutes: ctx.config.recoveryTokenTtlMinutes,
          });
        } else {
          ctx.logger.info('account recovery token issued; no mail provider configured, token not delivered', { userId: user.id });
        }
      }
      return c.json({ accepted: true as const }, 202);
    })
    .post('/recovery/complete', zv('json', RecoveryCompleteRequestSchema), async (c) => {
      const key = limiterKey(clientIp(c), 'recovery-complete');
      const retry = ctx.signInLimiter.check(key);
      if (retry !== null) throw errors.rateLimited(retry);
      ctx.signInLimiter.hit(key);
      const { token, newPassword } = c.req.valid('json');
      await completeRecovery(ctx, token, newPassword);
      clearSessionCookie(c, ctx);
      return c.json({ ok: true as const }, 200);
    });
}
