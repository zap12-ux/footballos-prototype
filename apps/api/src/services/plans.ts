import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  PLAN_SECTION_KEYS_BY_UNIT, type CreatePlanCommentRequest, type GamePlan, type GamePlanVersion, type GamePlanVersionSummary, type PatchPlanVersionRequest, type PlanComment,
  type PlanItem, type PlanSection, type PlanSectionKey, type ReviewFlag, type Unit,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { gamePlans, planComments, planVersions, type InputHashes, type PlanBaselineHashes } from '../db/schema.js';
import { errors } from '../errors.js';
import { planReviewFlags } from '../libs/index.js';
import { writeAudit } from './audit.js';
import type { GameRow } from './schedule.js';

export type PlanRow = typeof gamePlans.$inferSelect;
export type PlanVersionRow = typeof planVersions.$inferSelect;
export type CommentRow = typeof planComments.$inferSelect;

export const SECTION_TITLES: Record<PlanSectionKey, string> = {
  objectives: 'Objectives', personnel: 'Personnel', formations: 'Formations', runs: 'Runs', passes: 'Passes', protections: 'Protections', opening_script: 'Opening script',
  third_down: 'Third down', red_zone: 'Red zone', short_yardage: 'Short yardage', two_minute: 'Two minute', opponent_tendencies: 'Opponent tendencies', fronts: 'Fronts',
  fits: 'Fits', coverages: 'Coverages', pressures: 'Pressures', matchups: 'Matchups', kickoff_return: 'Kickoff / return', punt_protection_return: 'Punt protection / return',
  fg_pat: 'FG / PAT', opponent_alerts: 'Opponent alerts', special_situations: 'Special situations',
};

/** §11 template: every section key of the unit, in order, with no items. */
export function templateSections(unit: Unit): PlanSection[] {
  return PLAN_SECTION_KEYS_BY_UNIT[unit].map((key) => ({ key, title: SECTION_TITLES[key], items: [] }));
}

export const serializePlan = (p: PlanRow): GamePlan => ({ id: p.id, teamId: p.teamId, gameId: p.gameId, unit: p.unit as Unit, currentVersionId: p.currentVersionId, createdAt: p.createdAt });

export const serializeVersion = (v: PlanVersionRow): GamePlanVersion => ({
  id: v.id, planId: v.planId, number: v.number, status: v.status as GamePlanVersion['status'], basedOn: v.basedOn, sections: v.sections, createdBy: v.createdBy, createdAt: v.createdAt,
  approvedBy: v.approvedBy, approvedAt: v.approvedAt, override: v.override, version: v.version,
});

export const serializeVersionSummary = (v: PlanVersionRow): GamePlanVersionSummary => {
  const { sections, ...rest } = serializeVersion(v);
  return { ...rest, itemCount: sections.reduce((n, s) => n + s.items.length, 0) };
};

export const serializeComment = (c: CommentRow): PlanComment => ({
  id: c.id, versionId: c.versionId, sectionKey: c.sectionKey as PlanSectionKey | null, itemId: c.itemId, authorUserId: c.authorUserId, body: c.body, createdAt: c.createdAt, resolvedAt: c.resolvedAt,
});

// Lookups -------------------------------------------------------------------------------------------

export function getPlan(db: Db, gameId: string, unit: Unit): PlanRow | undefined {
  return db.select().from(gamePlans).where(and(eq(gamePlans.gameId, gameId), eq(gamePlans.unit, unit))).get();
}

export function getPlanById(db: Db, id: string): PlanRow | undefined {
  return db.select().from(gamePlans).where(eq(gamePlans.id, id)).get();
}

export function listVersions(db: Db, planId: string): PlanVersionRow[] {
  return db.select().from(planVersions).where(eq(planVersions.planId, planId)).orderBy(asc(planVersions.number)).all();
}

export function getVersion(db: Db, id: string): PlanVersionRow | undefined {
  return db.select().from(planVersions).where(eq(planVersions.id, id)).get();
}

export function requireVersion(ctx: AppContext, id: string, teamIds: string[]): PlanVersionRow {
  const v = getVersion(ctx.db, id);
  if (!v || !teamIds.includes(v.teamId)) throw errors.notFound('Plan version');
  return v;
}

/** The version coaches work on: the open draft / in_review one, else the approved one, else the newest. */
export function currentVersion(versions: PlanVersionRow[]): PlanVersionRow | undefined {
  return versions.find((v) => v.status === 'draft' || v.status === 'in_review') ?? versions.find((v) => v.status === 'approved') ?? versions[versions.length - 1];
}

export function openVersion(db: Db, planId: string): PlanVersionRow | undefined {
  return db.select().from(planVersions).where(and(eq(planVersions.planId, planId), inArray(planVersions.status, ['draft', 'in_review']))).get();
}

export function approvedPlanVersion(db: Db, planId: string): PlanVersionRow | undefined {
  return db.select().from(planVersions).where(and(eq(planVersions.planId, planId), eq(planVersions.status, 'approved'))).orderBy(desc(planVersions.number)).get();
}

function baseline(hashes: InputHashes, at: string): PlanBaselineHashes {
  return { ...hashes, at };
}

// Creation ------------------------------------------------------------------------------------------

/** First access creates the plan with draft version 1 from the unit template (§15.4). Runs inside `tx`. */
export function ensurePlan(ctx: AppContext, tx: Db, game: GameRow, unit: Unit, actorUserId: string, hashes: InputHashes): { plan: PlanRow; created: boolean } {
  const existing = getPlan(tx, game.id, unit);
  if (existing) return { plan: existing, created: false };
  const nowIso = ctx.now().toISOString();
  const planId = crypto.randomUUID();
  const version: PlanVersionRow = {
    id: crypto.randomUUID(), teamId: game.teamId, planId, number: 1, status: 'draft', basedOn: null, sections: templateSections(unit), createdBy: actorUserId, createdAt: nowIso,
    submittedAt: null, approvedBy: null, approvedAt: null, override: false, baselineHashes: baseline(hashes, nowIso), version: 1, updatedAt: nowIso,
  };
  const plan: PlanRow = { id: planId, teamId: game.teamId, gameId: game.id, unit, currentVersionId: version.id, createdAt: nowIso };
  tx.insert(gamePlans).values(plan).run();
  tx.insert(planVersions).values(version).run();
  return { plan, created: true };
}

/** The draft that receives edits or accepted recommendations; creates one from the approved version when needed. */
export function ensureDraft(ctx: AppContext, tx: Db, plan: PlanRow, actorUserId: string, hashes: InputHashes): PlanVersionRow {
  const open = openVersion(tx, plan.id);
  if (open?.status === 'draft') return open;
  if (open) throw errors.conflict('The plan is in review; reopen it before changing it', { currentStatus: open.status, versionId: open.id, reason: 'in_review' });
  const approved = approvedPlanVersion(tx, plan.id);
  if (!approved) {
    // Every version is superseded (should not happen); start a fresh template draft.
    return insertDraft(ctx, tx, plan, null, templateSections(plan.unit as Unit), actorUserId, hashes);
  }
  return insertDraft(ctx, tx, plan, approved, approved.sections, actorUserId, hashes);
}

function insertDraft(ctx: AppContext, tx: Db, plan: PlanRow, basedOn: PlanVersionRow | null, sections: PlanSection[], actorUserId: string, hashes: InputHashes): PlanVersionRow {
  const nowIso = ctx.now().toISOString();
  const number = (listVersions(tx, plan.id).at(-1)?.number ?? 0) + 1;
  const row: PlanVersionRow = {
    id: crypto.randomUUID(), teamId: plan.teamId, planId: plan.id, number, status: 'draft', basedOn: basedOn?.id ?? null, sections: structuredClone(sections), createdBy: actorUserId, createdAt: nowIso,
    submittedAt: null, approvedBy: null, approvedAt: null, override: false, baselineHashes: baseline(hashes, nowIso), version: 1, updatedAt: nowIso,
  };
  tx.insert(planVersions).values(row).run();
  tx.update(gamePlans).set({ currentVersionId: row.id }).where(eq(gamePlans.id, plan.id)).run();
  writeAudit(ctx, { teamId: plan.teamId, actorUserId, action: 'plan.draft_created', targetType: 'plan_version', targetId: row.id, details: { planId: plan.id, number, basedOn: basedOn?.id ?? null } });
  return row;
}

/** `POST /plan-versions/:id/draft`: a new draft based on an approved version; at most one open version per plan. */
export function createDraftFrom(ctx: AppContext, actorUserId: string, approved: PlanVersionRow, hashes: InputHashes): PlanVersionRow {
  if (approved.status !== 'approved') throw errors.conflict(`A new draft starts from an approved version; this one is ${approved.status}`, { currentStatus: approved.status, reason: 'not_approved' });
  return ctx.db.transaction((tx) => {
    const plan = getPlanById(tx, approved.planId)!;
    const open = openVersion(tx, plan.id);
    if (open) throw errors.conflict('The plan already has an open draft', { currentStatus: open.status, versionId: open.id, reason: 'draft_exists' });
    return insertDraft(ctx, tx, plan, approved, approved.sections, actorUserId, hashes);
  });
}

// Editing --------------------------------------------------------------------------------------------

export function validateSections(unit: Unit, sections: PlanSection[]): void {
  const allowed = new Set<string>(PLAN_SECTION_KEYS_BY_UNIT[unit]);
  const keys = new Set<string>();
  const itemIds = new Set<string>();
  for (const s of sections) {
    if (!allowed.has(s.key)) throw errors.validation(`Section "${s.key}" does not belong to a ${unit} plan`, { allowed: [...allowed] });
    if (keys.has(s.key)) throw errors.validation(`Section "${s.key}" appears twice`);
    keys.add(s.key);
    for (const it of s.items) {
      if (itemIds.has(it.id)) throw errors.validation(`Item ${it.id} appears twice`);
      itemIds.add(it.id);
    }
  }
}

export function patchVersion(ctx: AppContext, actorUserId: string, v: PlanVersionRow, body: PatchPlanVersionRequest): PlanVersionRow {
  if (v.status !== 'draft') throw errors.conflict(`Plan version is ${v.status}; only a draft can be edited`, { currentStatus: v.status, reason: 'not_draft' });
  const plan = getPlanById(ctx.db, v.planId)!;
  validateSections(plan.unit as Unit, body.sections);
  if (body.expectedVersion !== v.version) {
    throw errors.conflict(`Plan version ${body.expectedVersion} expected, current is ${v.version}`, { currentVersion: v.version, current: serializeVersion(v) });
  }
  const nowIso = ctx.now().toISOString();
  const next: PlanVersionRow = { ...v, sections: body.sections, version: v.version + 1, updatedAt: nowIso };
  const res = ctx.db.update(planVersions).set({ sections: next.sections, version: next.version, updatedAt: nowIso }).where(and(eq(planVersions.id, v.id), eq(planVersions.version, v.version), eq(planVersions.status, 'draft'))).run();
  if (res.changes !== 1) {
    const cur = getVersion(ctx.db, v.id)!;
    throw errors.conflict(`Plan version ${body.expectedVersion} expected, current is ${cur.version}`, { currentVersion: cur.version, current: serializeVersion(cur) });
  }
  void actorUserId;
  return next;
}

/** Section a recommendation-backed item lands in: by its first grounded concept's kind, else the unit's lead section. */
export function sectionKeyForItem(unit: Unit, conceptKind: string | null): PlanSectionKey {
  const byKind: Record<string, PlanSectionKey> = { run: 'runs', pass: 'passes', protection: 'protections', formation: 'formations', front: 'fronts', coverage: 'coverages', pressure: 'pressures', special_teams: 'special_situations' };
  const candidate = conceptKind ? byKind[conceptKind] : undefined;
  if (candidate && (PLAN_SECTION_KEYS_BY_UNIT[unit] as readonly string[]).includes(candidate)) return candidate;
  return unit === 'offense' ? 'objectives' : unit === 'defense' ? 'opponent_tendencies' : 'opponent_alerts';
}

/** Appends an item to a draft inside `tx` (bumps the version; concurrent editors see a 409 on their next PATCH). */
export function appendItem(ctx: AppContext, tx: Db, draft: PlanVersionRow, sectionKey: PlanSectionKey, item: Omit<PlanItem, 'id' | 'order'>): { version: PlanVersionRow; item: PlanItem } {
  const sections = structuredClone(draft.sections);
  let section = sections.find((s) => s.key === sectionKey);
  if (!section) { section = { key: sectionKey, title: SECTION_TITLES[sectionKey], items: [] }; sections.push(section); }
  const full: PlanItem = { id: crypto.randomUUID(), order: section.items.length, ...item };
  section.items.push(full);
  const nowIso = ctx.now().toISOString();
  tx.update(planVersions).set({ sections, version: draft.version + 1, updatedAt: nowIso }).where(eq(planVersions.id, draft.id)).run();
  return { version: { ...draft, sections, version: draft.version + 1, updatedAt: nowIso }, item: full };
}

// Transitions ------------------------------------------------------------------------------------------

export function submitVersion(ctx: AppContext, actorUserId: string, v: PlanVersionRow, note: string | undefined): PlanVersionRow {
  if (v.status !== 'draft') throw errors.conflict(`Only a draft can be submitted; this version is ${v.status}`, { currentStatus: v.status });
  const nowIso = ctx.now().toISOString();
  ctx.db.update(planVersions).set({ status: 'in_review', submittedAt: nowIso, version: v.version + 1, updatedAt: nowIso }).where(eq(planVersions.id, v.id)).run();
  writeAudit(ctx, { teamId: v.teamId, actorUserId, action: 'plan.submitted', targetType: 'plan_version', targetId: v.id, details: { planId: v.planId, number: v.number, note: note ?? null } });
  return { ...v, status: 'in_review', submittedAt: nowIso, version: v.version + 1, updatedAt: nowIso };
}

export function approveVersion(ctx: AppContext, actorUserId: string, v: PlanVersionRow, override: boolean, note: string | undefined, hashes: InputHashes): PlanVersionRow {
  if (v.status !== 'draft' && v.status !== 'in_review') throw errors.conflict(`Plan version is ${v.status} and cannot be approved`, { currentStatus: v.status });
  const nowIso = ctx.now().toISOString();
  return ctx.db.transaction((tx) => {
    const previous = approvedPlanVersion(tx, v.planId);
    if (previous) tx.update(planVersions).set({ status: 'superseded', updatedAt: nowIso }).where(eq(planVersions.id, previous.id)).run();
    tx.update(planVersions)
      .set({ status: 'approved', approvedBy: actorUserId, approvedAt: nowIso, override, baselineHashes: baseline(hashes, nowIso), version: v.version + 1, updatedAt: nowIso })
      .where(eq(planVersions.id, v.id)).run();
    tx.update(gamePlans).set({ currentVersionId: v.id }).where(eq(gamePlans.id, v.planId)).run();
    writeAudit(ctx, {
      teamId: v.teamId, actorUserId, action: override ? 'plan.override_approved' : 'plan.approved', targetType: 'plan_version', targetId: v.id,
      details: { planId: v.planId, number: v.number, override, superseded: previous?.id ?? null, note: note ?? null },
    });
    return { ...v, status: 'approved', approvedBy: actorUserId, approvedAt: nowIso, override, baselineHashes: baseline(hashes, nowIso), version: v.version + 1, updatedAt: nowIso };
  });
}

export function reopenVersion(ctx: AppContext, actorUserId: string, v: PlanVersionRow, note: string | undefined): PlanVersionRow {
  if (v.status !== 'in_review') {
    throw errors.conflict(v.status === 'approved' ? 'An approved version is immutable; create a new draft from it' : `Plan version is ${v.status} and cannot be reopened`, { currentStatus: v.status });
  }
  const nowIso = ctx.now().toISOString();
  ctx.db.update(planVersions).set({ status: 'draft', submittedAt: null, version: v.version + 1, updatedAt: nowIso }).where(eq(planVersions.id, v.id)).run();
  writeAudit(ctx, { teamId: v.teamId, actorUserId, action: 'plan.reopened', targetType: 'plan_version', targetId: v.id, details: { planId: v.planId, number: v.number, note: note ?? null } });
  return { ...v, status: 'draft', submittedAt: null, version: v.version + 1, updatedAt: nowIso };
}

// Comments ----------------------------------------------------------------------------------------------

export function listComments(db: Db, versionId: string): CommentRow[] {
  return db.select().from(planComments).where(eq(planComments.versionId, versionId)).orderBy(asc(planComments.createdAt)).all();
}

export function createComment(ctx: AppContext, actorUserId: string, v: PlanVersionRow, body: CreatePlanCommentRequest): CommentRow {
  const section = body.sectionKey ? v.sections.find((s) => s.key === body.sectionKey) : undefined;
  if (body.sectionKey && !section) throw errors.validation(`Section "${body.sectionKey}" is not in this version`);
  if (body.itemId) {
    const scope = section ? [section] : v.sections;
    if (!scope.some((s) => s.items.some((i) => i.id === body.itemId))) throw errors.validation(section ? `itemId is not in section "${section.key}"` : 'itemId is not in this version');
  }
  const row: CommentRow = {
    id: crypto.randomUUID(), teamId: v.teamId, versionId: v.id, sectionKey: body.sectionKey ?? null, itemId: body.itemId ?? null, authorUserId: actorUserId, body: body.body,
    createdAt: ctx.now().toISOString(), resolvedAt: null, resolvedBy: null,
  };
  ctx.db.insert(planComments).values(row).run();
  return row;
}

export function getComment(db: Db, id: string): CommentRow | undefined {
  return db.select().from(planComments).where(eq(planComments.id, id)).get();
}

export function resolveComment(ctx: AppContext, actorUserId: string, c: CommentRow): CommentRow {
  if (c.resolvedAt) return c;
  const nowIso = ctx.now().toISOString();
  ctx.db.update(planComments).set({ resolvedAt: nowIso, resolvedBy: actorUserId }).where(eq(planComments.id, c.id)).run();
  writeAudit(ctx, { teamId: c.teamId, actorUserId, action: 'plan.comment_resolved', targetType: 'plan_comment', targetId: c.id, details: { versionId: c.versionId } });
  return { ...c, resolvedAt: nowIso, resolvedBy: actorUserId };
}

// Review flags -------------------------------------------------------------------------------------------

/** §15.4 flags for one version, computed on read; never stored. */
export function reviewFlagsFor(v: PlanVersionRow, recommendations: Parameters<typeof planReviewFlags>[0]['recommendations'], currentHashes: InputHashes): ReviewFlag[] {
  const flags = planReviewFlags({ version: serializeVersion(v), recommendations, currentHashes, baselineHashes: v.baselineHashes });
  return flags.map((f) => ({ kind: f.kind, message: f.message, versionId: v.id, itemId: f.itemId ?? null, since: f.since }));
}
