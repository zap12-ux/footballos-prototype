import { z } from 'zod';
import { IdSchema, TimestampSchema, UnitSchema } from './common.js';

// §3 Auth and authorization ---------------------------------------------------------------

export const RoleSchema = z.enum(['head_coach', 'coordinator', 'position_coach', 'analyst', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;

export const EmailSchema = z.email().max(254).transform((e) => e.trim().toLowerCase());
export const PasswordSchema = z.string().min(12).max(256);
export const DisplayNameSchema = z.string().trim().min(1).max(120);

export const InviteSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  email: z.email(),
  role: RoleSchema,
  unit: UnitSchema.nullable(),
  expiresAt: TimestampSchema,
  acceptedAt: TimestampSchema.nullable(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
});
export type Invite = z.infer<typeof InviteSchema>;

/** Serialized user. `passwordHash` is never serialized and therefore not part of this schema. */
export const UserSchema = z.object({
  id: IdSchema,
  email: z.email(),
  displayName: DisplayNameSchema,
  mfaEnabled: z.boolean(),
  createdAt: TimestampSchema,
});
export type User = z.infer<typeof UserSchema>;

export const SessionSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  lastSeenAt: TimestampSchema,
  mfaVerified: z.boolean(),
  /** Hashed; never the raw address. */
  ip: z.string().nullable(),
  /** Truncated to 200 characters. */
  userAgent: z.string().max(200).nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const StaffMembershipSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  userId: IdSchema,
  role: RoleSchema,
  units: z.array(UnitSchema),
  title: z.string().max(120),
  active: z.boolean(),
  createdAt: TimestampSchema,
});
export type StaffMembership = z.infer<typeof StaffMembershipSchema>;

/** Membership joined with the user's public fields, as returned by `GET /teams/:teamId/staff`. */
export const StaffMemberSchema = StaffMembershipSchema.extend({
  user: UserSchema,
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

export const AuditActionSchema = z.enum([
  'invite.created',
  'invite.accepted',
  'invite.revoked',
  'staff.role_changed',
  'staff.deactivated',
  'staff.reactivated',
  'mfa.enrolled',
  'recovery.completed',
  'schedule_import.applied',
  'game.deleted',
  'plan.approved',
  'plan.override_approved',
  'share_link.created',
  'share_link.revoked',
  'asset.deleted',
  'retention.applied',
  'playbook.approved',
  'roster.edited',
  'settings.changed',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditEventSchema = z.object({
  id: IdSchema,
  teamId: IdSchema,
  actorUserId: IdSchema.nullable(),
  action: AuditActionSchema,
  targetType: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64).nullable(),
  at: TimestampSchema,
  details: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// Auth request / response shapes ----------------------------------------------------------

export const SignInRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(256),
});
export type SignInRequest = z.infer<typeof SignInRequestSchema>;

export const AuthStateSchema = z.object({
  user: UserSchema,
  /** True when the session still has to complete TOTP verification. */
  mfaRequired: z.boolean(),
  /** True when the user's role demands MFA but no authenticator is enrolled yet. */
  mfaEnrollmentRequired: z.boolean(),
  memberships: z.array(StaffMembershipSchema),
});
export type AuthState = z.infer<typeof AuthStateSchema>;

export const AcceptInviteRequestSchema = z.object({
  displayName: DisplayNameSchema,
  password: PasswordSchema,
});
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequestSchema>;

export const MfaSetupResponseSchema = z.object({
  secret: z.string().min(16),
  otpauthUrl: z.string().url(),
});
export type MfaSetupResponse = z.infer<typeof MfaSetupResponseSchema>;

export const MfaVerifyRequestSchema = z.object({
  /** Six-digit TOTP code, or a recovery code of the form `xxxx-xxxx-xxxx`. */
  code: z.string().trim().min(6).max(32),
});
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

export const MfaVerifyResponseSchema = z.object({
  mfaVerified: z.literal(true),
  /** Returned once, only when enrollment was just completed. */
  recoveryCodes: z.array(z.string()).length(10).optional(),
});
export type MfaVerifyResponse = z.infer<typeof MfaVerifyResponseSchema>;

export const RecoveryRequestSchema = z.object({ email: EmailSchema });
export type RecoveryRequest = z.infer<typeof RecoveryRequestSchema>;

export const RecoveryCompleteRequestSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: PasswordSchema,
});
export type RecoveryCompleteRequest = z.infer<typeof RecoveryCompleteRequestSchema>;

export const CreateInviteRequestSchema = z.object({
  email: EmailSchema,
  role: RoleSchema,
  unit: UnitSchema.nullable().default(null),
  /** Hours until the invite expires; default 7 days. */
  expiresInHours: z.number().int().min(1).max(24 * 30).default(24 * 7),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteRequestSchema>;

/** Returned to the inviting head coach once; the raw token is never stored. */
export const CreatedInviteSchema = InviteSchema.extend({ token: z.string() });
export type CreatedInvite = z.infer<typeof CreatedInviteSchema>;

export const PatchStaffRequestSchema = z
  .object({
    role: RoleSchema.optional(),
    units: z.array(UnitSchema).optional(),
    title: z.string().max(120).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type PatchStaffRequest = z.infer<typeof PatchStaffRequestSchema>;
