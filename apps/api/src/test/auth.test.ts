import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentTotp } from '../auth/totp.js';
import { listAuditByActions } from '../services/teams.js';
import { addStaff, call, makeTestApp, PASSWORD, seedTeam, seedUser, signIn, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(() => { t = makeTestApp(); });
afterAll(() => t.close());

describe('sign-in', () => {
  it('succeeds with the right password and sets an httpOnly fos_session cookie', async () => {
    await seedUser(t, 'viewer@alpha.test');
    const res = await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'Viewer@Alpha.test', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('viewer@alpha.test');
    expect(res.body.mfaRequired).toBe(false);
    expect(res.cookie).toMatch(/^fos_session=/);
    const raw = res.headers.get('set-cookie')!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).not.toMatch(/Secure/);
  });

  it('fails with the wrong password or unknown e-mail (same 401, no enumeration)', async () => {
    const wrong = await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'viewer@alpha.test', password: 'nope-nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('unauthorized');
    const unknown = await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'nobody@alpha.test', password: 'nope-nope-nope-nope' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('rejects malformed bodies with validation_error and issues', async () => {
    const res = await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.issues.length).toBeGreaterThan(0);
  });

  it('rate-limits repeated failures per IP + e-mail with retryAfterSec', async () => {
    await seedUser(t, 'limited@alpha.test');
    const attempt = () => call(t, 'POST', '/api/v1/auth/sign-in', { email: 'limited@alpha.test', password: 'wrong-wrong-wrong' }, null, { 'x-forwarded-for': '10.0.0.9' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(limited.body.error.details.retryAfterSec).toBeGreaterThan(0);
    // a different IP is not affected
    const other = await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'limited@alpha.test', password: PASSWORD }, null, { 'x-forwarded-for': '10.0.0.10' });
    expect(other.status).toBe(200);
  });

  it('GET /auth/me needs a session; sign-out revokes it', async () => {
    expect((await call(t, 'GET', '/api/v1/auth/me')).status).toBe(401);
    const cookie = await signIn(t, 'viewer@alpha.test');
    expect((await call(t, 'GET', '/api/v1/auth/me', undefined, cookie)).status).toBe(200);
    const out = await call(t, 'POST', '/api/v1/auth/sign-out', undefined, cookie);
    expect(out.status).toBe(200);
    expect((await call(t, 'GET', '/api/v1/auth/me', undefined, cookie)).status).toBe(401);
  });

  it('a tampered cookie is rejected', async () => {
    const cookie = await signIn(t, 'viewer@alpha.test');
    const tampered = cookie.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a'));
    expect((await call(t, 'GET', '/api/v1/auth/me', undefined, tampered)).status).toBe(401);
  });

  it('sessions expire after the idle timeout (12 h) and the absolute limit (30 d)', async () => {
    const cookie = await signIn(t, 'viewer@alpha.test');
    t.clock.advanceMs(11 * 3_600_000);
    expect((await call(t, 'GET', '/api/v1/auth/me', undefined, cookie)).status).toBe(200);
    t.clock.advanceMs(13 * 3_600_000);
    expect((await call(t, 'GET', '/api/v1/auth/me', undefined, cookie)).status).toBe(401);
    const cookie2 = await signIn(t, 'viewer@alpha.test');
    // keep the session active (11 h steps stay under the idle limit) until the absolute 30 d limit
    for (let i = 0; i < 64; i++) {
      t.clock.advanceMs(11 * 3_600_000);
      expect((await call(t, 'GET', '/api/v1/auth/me', undefined, cookie2)).status).toBe(200);
    }
    t.clock.advanceMs(11 * 3_600_000); // 29.6 d
    expect((await call(t, 'GET', '/api/v1/auth/me', undefined, cookie2)).status).toBe(200);
    t.clock.advanceMs(11 * 3_600_000); // 30.1 d
    expect((await call(t, 'GET', '/api/v1/auth/me', undefined, cookie2)).status).toBe(401);
  });
});

describe('MFA', () => {
  it('gates team routes with 401 mfaRequired until the TOTP code is verified', async () => {
    const { team } = seedTeam(t, 'Mfa Team (demo)');
    const { user, totpSecret } = await seedUser(t, 'hc@mfa.test', { mfa: true });
    addStaff(t, team.id, user.id, 'head_coach');
    const res = await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'hc@mfa.test', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.mfaRequired).toBe(true);
    const gated = await call(t, 'GET', `/api/v1/teams/${team.id}`, undefined, res.cookie);
    expect(gated.status).toBe(401);
    expect(gated.body.error.details).toEqual({ mfaRequired: true });
    const me = await call(t, 'GET', '/api/v1/auth/me', undefined, res.cookie);
    expect(me.status).toBe(200);
    expect(me.body.mfaRequired).toBe(true);
    const bad = await call(t, 'POST', '/api/v1/auth/mfa/verify', { code: '000000' }, res.cookie);
    expect(bad.status).toBe(401);
    const ok = await call(t, 'POST', '/api/v1/auth/mfa/verify', { code: currentTotp(totpSecret!) }, res.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ mfaVerified: true });
    expect((await call(t, 'GET', `/api/v1/teams/${team.id}`, undefined, res.cookie)).status).toBe(200);
  });

  it('a head coach without MFA is told to enroll; setup + verify returns 10 recovery codes, and one recovery code works once', async () => {
    const { team } = seedTeam(t, 'Enroll Team (demo)');
    const { user } = await seedUser(t, 'hc@enroll.test');
    addStaff(t, team.id, user.id, 'head_coach');
    const cookie = await signIn(t, 'hc@enroll.test');
    const gated = await call(t, 'GET', `/api/v1/teams/${team.id}`, undefined, cookie);
    expect(gated.status).toBe(401);
    expect(gated.body.error.details).toEqual({ mfaRequired: true, mfaEnrollmentRequired: true });
    const setup = await call(t, 'POST', '/api/v1/auth/mfa/setup', undefined, cookie);
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const verify = await call(t, 'POST', '/api/v1/auth/mfa/verify', { code: currentTotp(setup.body.secret) }, cookie);
    expect(verify.status).toBe(200);
    expect(verify.body.recoveryCodes).toHaveLength(10);
    expect((await call(t, 'GET', `/api/v1/teams/${team.id}`, undefined, cookie)).status).toBe(200);
    expect(listAuditByActions(t.ctx, team.id, ['mfa.enrolled'])).toHaveLength(1);
    // next sign-in: recovery code instead of TOTP, single use
    const again = await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'hc@enroll.test', password: PASSWORD });
    const code = verify.body.recoveryCodes[0];
    expect((await call(t, 'POST', '/api/v1/auth/mfa/verify', { code }, again.cookie)).status).toBe(200);
    const third = await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'hc@enroll.test', password: PASSWORD });
    expect((await call(t, 'POST', '/api/v1/auth/mfa/verify', { code }, third.cookie)).status).toBe(401);
  });
});

describe('invites', () => {
  it('head coach creates an invite (audited); accepting it creates the user, membership and session', async () => {
    const { team } = seedTeam(t, 'Invite Team (demo)');
    const hc = await seedUser(t, 'hc@invite.test', { mfa: true });
    addStaff(t, team.id, hc.user.id, 'head_coach');
    const hcCookie = await signIn(t, 'hc@invite.test', hc.totpSecret);
    const created = await call(t, 'POST', `/api/v1/teams/${team.id}/invites`, { email: 'New.Coach@invite.test', role: 'position_coach', unit: 'defense' }, hcCookie);
    expect(created.status).toBe(201);
    expect(created.body.token).toBeTypeOf('string');
    expect(created.body.email).toBe('new.coach@invite.test');
    expect(listAuditByActions(t.ctx, team.id, ['invite.created'])).toHaveLength(1);

    const short = await call(t, 'POST', `/api/v1/auth/invites/${created.body.token}/accept`, { displayName: 'New Coach', password: 'short' });
    expect(short.status).toBe(400);
    const accepted = await call(t, 'POST', `/api/v1/auth/invites/${created.body.token}/accept`, { displayName: 'New Coach', password: 'a-long-enough-password' });
    expect(accepted.status).toBe(201);
    expect(accepted.body.user.email).toBe('new.coach@invite.test');
    expect(accepted.body.memberships[0]).toMatchObject({ teamId: team.id, role: 'position_coach', units: ['defense'] });
    expect(accepted.cookie).toMatch(/^fos_session=/);
    expect((await call(t, 'GET', `/api/v1/teams/${team.id}`, undefined, accepted.cookie)).status).toBe(200);
    expect(listAuditByActions(t.ctx, team.id, ['invite.accepted'])).toHaveLength(1);
    // token is single use; unknown tokens are 404
    expect((await call(t, 'POST', `/api/v1/auth/invites/${created.body.token}/accept`, { displayName: 'x', password: 'a-long-enough-password' })).status).toBe(404);
    expect((await call(t, 'POST', `/api/v1/auth/invites/${'x'.repeat(40)}/accept`, { displayName: 'x', password: 'a-long-enough-password' })).status).toBe(404);
  });

  it('expired invites are not accepted', async () => {
    const { team } = seedTeam(t, 'Expire Team (demo)');
    const hc = await seedUser(t, 'hc@expire.test', { mfa: true });
    addStaff(t, team.id, hc.user.id, 'head_coach');
    const hcCookie = await signIn(t, 'hc@expire.test', hc.totpSecret);
    const created = await call(t, 'POST', `/api/v1/teams/${team.id}/invites`, { email: 'late@expire.test', role: 'viewer', expiresInHours: 1 }, hcCookie);
    t.clock.advanceMs(2 * 3_600_000);
    expect((await call(t, 'POST', `/api/v1/auth/invites/${created.body.token}/accept`, { displayName: 'Late', password: 'a-long-enough-password' })).status).toBe(404);
  });
});

describe('account recovery', () => {
  it('request always answers 202; in development the token is logged; complete sets the password and revokes sessions', async () => {
    const { team } = seedTeam(t, 'Recovery Team (demo)');
    const { user } = await seedUser(t, 'forgot@recovery.test');
    addStaff(t, team.id, user.id, 'analyst');
    const oldCookie = await signIn(t, 'forgot@recovery.test');
    const unknown = await call(t, 'POST', '/api/v1/auth/recovery/request', { email: 'nobody@recovery.test' });
    expect(unknown.status).toBe(202);
    const req = await call(t, 'POST', '/api/v1/auth/recovery/request', { email: 'forgot@recovery.test' });
    expect(req.status).toBe(202);
    const line = t.logLines.map((l) => JSON.parse(l)).find((l) => l.unredacted_recovery_token && l.userId === user.id);
    expect(line).toBeTruthy();
    const token = line.unredacted_recovery_token as string;
    const done = await call(t, 'POST', '/api/v1/auth/recovery/complete', { token, newPassword: 'brand-new-password-123' });
    expect(done.status).toBe(200);
    expect((await call(t, 'GET', '/api/v1/auth/me', undefined, oldCookie)).status).toBe(401);
    expect((await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'forgot@recovery.test', password: PASSWORD })).status).toBe(401);
    expect((await call(t, 'POST', '/api/v1/auth/sign-in', { email: 'forgot@recovery.test', password: 'brand-new-password-123' })).status).toBe(200);
    expect((await call(t, 'POST', '/api/v1/auth/recovery/complete', { token, newPassword: 'another-new-password-123' })).status).toBe(404);
    expect(listAuditByActions(t.ctx, team.id, ['recovery.completed'])).toHaveLength(1);
  });

  it('never logs the token outside development/demo', async () => {
    const prod = makeTestApp({ FOOTBALLOS_ENV: 'research' });
    try {
      await seedUser(prod, 'forgot@research.test');
      await call(prod, 'POST', '/api/v1/auth/recovery/request', { email: 'forgot@research.test' });
      expect(prod.logLines.some((l) => l.includes('unredacted_recovery_token'))).toBe(false);
      expect(prod.logLines.some((l) => l.includes('token not delivered'))).toBe(true);
    } finally { prod.close(); }
  });
});
