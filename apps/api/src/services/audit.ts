import type { AuditAction } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { auditEvents } from '../db/schema.js';

export type AuditInput = {
  teamId: string;
  actorUserId: string | null;
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  details?: Record<string, unknown>;
};

/** Append-only. Never includes secrets or uploaded content in `details`. */
export function writeAudit(ctx: AppContext, input: AuditInput): typeof auditEvents.$inferSelect {
  const row = {
    id: crypto.randomUUID(),
    teamId: input.teamId,
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    at: ctx.now().toISOString(),
    details: input.details ?? {},
  };
  ctx.db.insert(auditEvents).values(row).run();
  return row;
}
