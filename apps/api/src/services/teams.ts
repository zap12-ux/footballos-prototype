import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { CreateInviteRequest, PatchStaffRequest, Role, TeamLevel, Unit } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { auditEvents, invites, staffMemberships, teams, users } from '../db/schema.js';
import { newToken, tokenHash } from '../auth/tokens.js';
import { writeAudit } from './audit.js';
import type { UserRow } from './users.js';
import { createUser } from './users.js';

export type TeamRow = typeof teams.$inferSelect;
export type MembershipRow = typeof staffMemberships.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;

export function createTeam(
  ctx: AppContext,
  input: { name: string; shortName: string; level: TeamLevel; environmentKind: 'demo' | 'research' | 'production'; timezone: string },
): TeamRow {
  const row: TeamRow = { id: crypto.randomUUID(), ...input, createdAt: ctx.now().toISOString() };
  ctx.db.insert(teams).values(row).run();
  return row;
}

export function getTeam(ctx: AppContext, teamId: string): TeamRow | undefined {
  return ctx.db.select().from(teams).where(eq(teams.id, teamId)).get();
}

export function listTeamsForUser(ctx: AppContext, userId: string): { team: TeamRow; membership: MembershipRow }[] {
  return ctx.db
    .select({ team: teams, membership: staffMemberships })
    .from(staffMemberships)
    .innerJoin(teams, eq(teams.id, staffMemberships.teamId))
    .where(and(eq(staffMemberships.userId, userId), eq(staffMemberships.active, true)))
    .all();
}

export function addMembership(
  ctx: AppContext,
  input: { teamId: string; userId: string; role: Role; units: Unit[]; title?: string },
): MembershipRow {
  const now = ctx.now().toISOString();
  const existing = ctx.db
    .select()
    .from(staffMemberships)
    .where(and(eq(staffMemberships.teamId, input.teamId), eq(staffMemberships.userId, input.userId)))
    .get();
  if (existing) {
    ctx.db
      .update(staffMemberships)
      .set({ role: input.role, units: input.units, title: input.title ?? existing.title, active: true, updatedAt: now })
      .where(eq(staffMemberships.id, existing.id))
      .run();
    return { ...existing, role: input.role, units: input.units, title: input.title ?? existing.title, active: true, updatedAt: now };
  }
  const row: MembershipRow = {
    id: crypto.randomUUID(),
    teamId: input.teamId,
    userId: input.userId,
    role: input.role,
    units: input.units,
    title: input.title ?? '',
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  ctx.db.insert(staffMemberships).values(row).run();
  return row;
}

export function listStaff(ctx: AppContext, teamId: string): { membership: MembershipRow; user: UserRow }[] {
  return ctx.db
    .select({ membership: staffMemberships, user: users })
    .from(staffMemberships)
    .innerJoin(users, eq(users.id, staffMemberships.userId))
    .where(eq(staffMemberships.teamId, teamId))
    .orderBy(staffMemberships.createdAt)
    .all();
}

export function getMembership(ctx: AppContext, teamId: string, membershipId: string): MembershipRow | undefined {
  return ctx.db
    .select()
    .from(staffMemberships)
    .where(and(eq(staffMemberships.id, membershipId), eq(staffMemberships.teamId, teamId)))
    .get();
}

export function patchStaff(ctx: AppContext, actorUserId: string, teamId: string, membershipId: string, patch: PatchStaffRequest): MembershipRow {
  const m = getMembership(ctx, teamId, membershipId);
  if (!m) throw errors.notFound('Staff membership');
  const becomingInactive = patch.active === false && m.active;
  const losingHeadCoach = m.role === 'head_coach' && ((patch.role && patch.role !== 'head_coach') || becomingInactive);
  if (losingHeadCoach) {
    const otherHeadCoaches = ctx.db
      .select({ id: staffMemberships.id })
      .from(staffMemberships)
      .where(and(eq(staffMemberships.teamId, teamId), eq(staffMemberships.role, 'head_coach'), eq(staffMemberships.active, true)))
      .all()
      .filter((r) => r.id !== m.id);
    if (otherHeadCoaches.length === 0) throw errors.conflict('A team must keep at least one active head coach');
  }
  const now = ctx.now().toISOString();
  const next: MembershipRow = {
    ...m,
    role: patch.role ?? m.role,
    units: patch.units ?? m.units,
    title: patch.title ?? m.title,
    active: patch.active ?? m.active,
    updatedAt: now,
  };
  ctx.db.update(staffMemberships).set({ role: next.role, units: next.units, title: next.title, active: next.active, updatedAt: now }).where(eq(staffMemberships.id, m.id)).run();
  const details = { before: { role: m.role, units: m.units, title: m.title, active: m.active }, after: { role: next.role, units: next.units, title: next.title, active: next.active } };
  if (becomingInactive) writeAudit(ctx, { teamId, actorUserId, action: 'staff.deactivated', targetType: 'staff_membership', targetId: m.id, details });
  else if (patch.active === true && !m.active) writeAudit(ctx, { teamId, actorUserId, action: 'staff.reactivated', targetType: 'staff_membership', targetId: m.id, details });
  if (patch.role !== undefined || patch.units !== undefined || patch.title !== undefined) {
    writeAudit(ctx, { teamId, actorUserId, action: 'staff.role_changed', targetType: 'staff_membership', targetId: m.id, details });
  }
  return next;
}

// Invites ---------------------------------------------------------------------------------------

export function createInvite(ctx: AppContext, actorUserId: string, teamId: string, input: CreateInviteRequest): { invite: InviteRow; token: string } {
  const now = ctx.now();
  const token = newToken(32);
  const row: InviteRow = {
    id: crypto.randomUUID(),
    teamId,
    email: input.email,
    role: input.role,
    unit: input.unit,
    tokenHash: tokenHash(ctx.config.sessionSecret, token),
    expiresAt: new Date(now.getTime() + input.expiresInHours * 3_600_000).toISOString(),
    acceptedAt: null,
    revokedAt: null,
    createdBy: actorUserId,
    createdAt: now.toISOString(),
  };
  ctx.db.insert(invites).values(row).run();
  writeAudit(ctx, { teamId, actorUserId, action: 'invite.created', targetType: 'invite', targetId: row.id, details: { email: row.email, role: row.role, unit: row.unit } });
  return { invite: row, token };
}

export function listOpenInvites(ctx: AppContext, teamId: string): InviteRow[] {
  return ctx.db
    .select()
    .from(invites)
    .where(and(eq(invites.teamId, teamId), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    .orderBy(desc(invites.createdAt))
    .all();
}

export function revokeInvite(ctx: AppContext, actorUserId: string, teamId: string, inviteId: string): InviteRow {
  const row = ctx.db.select().from(invites).where(and(eq(invites.id, inviteId), eq(invites.teamId, teamId))).get();
  if (!row) throw errors.notFound('Invite');
  if (row.acceptedAt) throw errors.conflict('Invite was already accepted');
  const now = ctx.now().toISOString();
  ctx.db.update(invites).set({ revokedAt: now }).where(eq(invites.id, row.id)).run();
  writeAudit(ctx, { teamId, actorUserId, action: 'invite.revoked', targetType: 'invite', targetId: row.id });
  return { ...row, revokedAt: now };
}

export function findOpenInviteByToken(ctx: AppContext, token: string): InviteRow | null {
  if (!token || token.length < 16) return null;
  const row = ctx.db.select().from(invites).where(eq(invites.tokenHash, tokenHash(ctx.config.sessionSecret, token))).get();
  if (!row || row.acceptedAt || row.revokedAt || new Date(row.expiresAt).getTime() <= ctx.now().getTime()) return null;
  return row;
}

/**
 * Accepts an invite. A brand-new e-mail creates the user; an existing user must already be signed
 * in as that e-mail (`currentUser`), otherwise `409 conflict` tells the client to sign in first.
 */
export async function acceptInvite(
  ctx: AppContext,
  token: string,
  input: { displayName: string; password: string },
  currentUser: UserRow | null,
): Promise<{ user: UserRow; membership: MembershipRow; invite: InviteRow; createdUser: boolean }> {
  const invite = findOpenInviteByToken(ctx, token);
  if (!invite) throw errors.notFound('Invite');
  const existing = ctx.db.select().from(users).where(eq(users.email, invite.email)).get();
  let user: UserRow;
  let createdUser = false;
  if (existing) {
    if (!currentUser || currentUser.id !== existing.id) {
      throw errors.conflict('An account with this e-mail already exists; sign in and accept the invite again', { existingAccount: true });
    }
    user = existing;
  } else {
    user = await createUser(ctx, { email: invite.email, displayName: input.displayName, password: input.password });
    createdUser = true;
  }
  const units: Unit[] = invite.unit ? [invite.unit as Unit] : invite.role === 'head_coach' ? ['offense', 'defense', 'special_teams'] : [];
  const membership = addMembership(ctx, { teamId: invite.teamId, userId: user.id, role: invite.role as Role, units });
  const now = ctx.now().toISOString();
  ctx.db.update(invites).set({ acceptedAt: now }).where(eq(invites.id, invite.id)).run();
  writeAudit(ctx, { teamId: invite.teamId, actorUserId: user.id, action: 'invite.accepted', targetType: 'invite', targetId: invite.id, details: { role: invite.role, createdUser } });
  return { user, membership, invite: { ...invite, acceptedAt: now }, createdUser };
}

// Audit log -----------------------------------------------------------------------------------

export function listAudit(ctx: AppContext, teamId: string, limit: number, cursor?: string) {
  const where = cursor ? and(eq(auditEvents.teamId, teamId), lt(auditEvents.at, cursor)) : eq(auditEvents.teamId, teamId);
  const rows = ctx.db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.at)).limit(limit + 1).all();
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1]!.at : null };
}

export function listAuditByActions(ctx: AppContext, teamId: string, actions: string[]) {
  return ctx.db.select().from(auditEvents).where(and(eq(auditEvents.teamId, teamId), inArray(auditEvents.action, actions))).all();
}
