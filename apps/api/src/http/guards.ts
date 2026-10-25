import type { MiddlewareHandler } from 'hono';
import type { Role, Unit } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { resolveSession, type AuthContext, type MembershipRow } from '../auth/session.js';

export type AppEnv = { Variables: { auth: AuthContext } };

export const MFA_REQUIRED_ROLES: readonly Role[] = ['head_coach', 'coordinator'];

export function mfaState(auth: AuthContext): { mfaRequired: boolean; mfaEnrollmentRequired: boolean } {
  const roleNeedsMfa = auth.memberships.some((m) => MFA_REQUIRED_ROLES.includes(m.role as Role));
  return {
    mfaRequired: auth.user.mfaEnabled && !auth.session.mfaVerified,
    mfaEnrollmentRequired: !auth.user.mfaEnabled && roleNeedsMfa,
  };
}

export function enforceMfa(auth: AuthContext): void {
  const s = mfaState(auth);
  if (s.mfaRequired) throw errors.unauthorized('Multi-factor verification required', { mfaRequired: true });
  if (s.mfaEnrollmentRequired) {
    throw errors.unauthorized('Multi-factor enrollment is required for your role', { mfaRequired: true, mfaEnrollmentRequired: true });
  }
}

/**
 * Loads the session into `c.var.auth`. Without `allowMfaPending`, a session that still owes TOTP
 * verification (or a head coach / coordinator without MFA enrolled) gets `401 unauthorized` with
 * `details.mfaRequired: true`.
 */
export function requireAuth(ctx: AppContext, opts: { allowMfaPending?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const auth = resolveSession(ctx, c);
    if (!auth) throw errors.unauthorized();
    c.set('auth', auth);
    if (!opts.allowMfaPending) enforceMfa(auth);
    await next();
  };
}

/** Team scoping: a user without an active membership gets `404`, never `403`, so other teams stay invisible. */
export function requireMembership(auth: AuthContext, teamId: string): MembershipRow {
  const m = auth.memberships.find((x) => x.teamId === teamId && x.active);
  if (!m) throw errors.notFound('Team');
  return m;
}

export function requireRole(m: MembershipRow, roles: readonly Role[]): void {
  if (!roles.includes(m.role as Role)) throw errors.forbidden(`Requires one of: ${roles.join(', ')}`);
}

// §3 policy table ----------------------------------------------------------------------------

export const policy = {
  /** View team records, comment. */
  canView: (_m: MembershipRow) => true,
  /** Upload film, correct labels. */
  canUploadOrCorrect: (m: MembershipRow) => (['head_coach', 'coordinator', 'position_coach', 'analyst'] as Role[]).includes(m.role as Role),
  /** Edit a unit's draft plan. */
  canEditUnitPlan: (m: MembershipRow, unit: Unit) =>
    m.role === 'head_coach' || ((m.role === 'coordinator' || m.role === 'position_coach') && m.units.includes(unit)),
  /** Approve a unit plan; head coach approval is recorded as an override. */
  canApproveUnitPlan: (m: MembershipRow, unit: Unit): { allowed: boolean; override: boolean } => {
    if (m.role === 'head_coach') return { allowed: true, override: true };
    if (m.role === 'coordinator' && m.units.includes(unit)) return { allowed: true, override: false };
    return { allowed: false, override: false };
  },
  /** Approve playbook extraction / roster edits. */
  canApproveExtraction: (m: MembershipRow, unit: Unit) => m.role === 'head_coach' || (m.role === 'coordinator' && m.units.includes(unit)),
  /** Manage staff, invites, retention, settings. */
  canManageTeam: (m: MembershipRow) => m.role === 'head_coach',
  /** Create seasons, games and schedule imports. */
  canManageSchedule: (m: MembershipRow) => m.role === 'head_coach' || m.role === 'coordinator',
};

export function assert(cond: boolean, message = 'Not permitted'): void {
  if (!cond) throw errors.forbidden(message);
}
