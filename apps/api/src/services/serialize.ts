import type {
  AuditEvent, Invite, Opponent, ScheduledGame, ScheduleImport, Season, StaffMembership, StaffMember, Team, User,
} from '@footballos/contracts';
import type * as s from '../db/schema.js';

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

export const serialize = {
  user: (u: Row<typeof s.users>): User => ({ id: u.id, email: u.email, displayName: u.displayName, mfaEnabled: u.mfaEnabled, createdAt: u.createdAt }),
  team: (t: Row<typeof s.teams>): Team => ({
    id: t.id, name: t.name, shortName: t.shortName, level: t.level as Team['level'], environmentKind: t.environmentKind as Team['environmentKind'],
    timezone: t.timezone, createdAt: t.createdAt,
  }),
  membership: (m: Row<typeof s.staffMemberships>): StaffMembership => ({
    id: m.id, teamId: m.teamId, userId: m.userId, role: m.role as StaffMembership['role'], units: m.units, title: m.title, active: m.active, createdAt: m.createdAt,
  }),
  staffMember: (m: Row<typeof s.staffMemberships>, u: Row<typeof s.users>): StaffMember => ({ ...serialize.membership(m), user: serialize.user(u) }),
  invite: (i: Row<typeof s.invites>): Invite => ({
    id: i.id, teamId: i.teamId, email: i.email, role: i.role as Invite['role'], unit: (i.unit as Invite['unit']) ?? null, expiresAt: i.expiresAt,
    acceptedAt: i.acceptedAt, createdBy: i.createdBy, createdAt: i.createdAt,
  }),
  season: (x: Row<typeof s.seasons>): Season => ({ id: x.id, teamId: x.teamId, label: x.label, startsOn: x.startsOn, endsOn: x.endsOn, isCurrent: x.isCurrent }),
  opponent: (o: Row<typeof s.opponents>): Opponent => ({ id: o.id, teamId: o.teamId, name: o.name, shortName: o.shortName, notes: o.notes }),
  game: (g: Row<typeof s.scheduledGames>): ScheduledGame => ({
    id: g.id, teamId: g.teamId, seasonId: g.seasonId, week: g.week, kind: g.kind as ScheduledGame['kind'], opponentId: g.opponentId,
    location: g.location as ScheduledGame['location'], scheduledAt: g.scheduledAt, status: g.status as ScheduledGame['status'], result: g.result ?? null,
    notes: g.notes, version: g.version, createdAt: g.createdAt, updatedAt: g.updatedAt,
  }),
  scheduleImport: (i: Row<typeof s.scheduleImports>): ScheduleImport => ({
    id: i.id, teamId: i.teamId, seasonId: i.seasonId, filename: i.filename, status: i.status as ScheduleImport['status'], mapping: i.mapping,
    rowCount: i.rowCount, rows: i.rows, errors: i.errors, createdAt: i.createdAt,
  }),
  audit: (a: Row<typeof s.auditEvents>): AuditEvent => ({
    id: a.id, teamId: a.teamId, actorUserId: a.actorUserId, action: a.action as AuditEvent['action'], targetType: a.targetType, targetId: a.targetId, at: a.at, details: a.details,
  }),
};
