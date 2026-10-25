import { eq } from 'drizzle-orm';
import type { PatchTeamSettingsRequest, TeamSettings } from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { teamSettings } from '../db/schema.js';
import { errors } from '../errors.js';
import { writeAudit } from './audit.js';
import { recomputeRetention } from './media.js';

/** Defaults when no row exists: keep originals and proxies until the head coach deletes (owner decision 2026-10-25). */
export function getSettings(ctx: AppContext, teamId: string): TeamSettings {
  const row = ctx.db.select().from(teamSettings).where(eq(teamSettings.teamId, teamId)).get();
  const l = ctx.config.limits;
  return {
    retentionDays: row?.retentionDays ?? null,
    uploadLimits: { maxUploadBytes: l.maxUploadBytes, uploadChunkBytes: l.uploadChunkBytes, allowedVideoContainers: l.allowedVideoContainers, uploadTtlHours: l.uploadTtlHours },
    version: row?.version ?? 1,
  };
}

export function patchSettings(ctx: AppContext, userId: string, teamId: string, body: PatchTeamSettingsRequest): TeamSettings {
  const current = getSettings(ctx, teamId);
  if (current.version !== body.expectedVersion) {
    throw errors.conflict(`Settings version ${body.expectedVersion} expected, current is ${current.version}`, { currentVersion: current.version });
  }
  const nowIso = ctx.now().toISOString();
  const retentionDays = body.retentionDays === undefined ? current.retentionDays : body.retentionDays;
  ctx.db.transaction((tx) => {
    tx.insert(teamSettings)
      .values({ teamId, retentionDays, version: current.version + 1, updatedBy: userId, updatedAt: nowIso })
      .onConflictDoUpdate({ target: teamSettings.teamId, set: { retentionDays, version: current.version + 1, updatedBy: userId, updatedAt: nowIso } })
      .run();
    if (retentionDays !== current.retentionDays) recomputeRetention(tx, teamId, retentionDays, nowIso);
  });
  writeAudit(ctx, { teamId, actorUserId: userId, action: 'settings.changed', targetType: 'team_settings', targetId: teamId, details: { retentionDays: { from: current.retentionDays, to: retentionDays } } });
  return getSettings(ctx, teamId);
}
