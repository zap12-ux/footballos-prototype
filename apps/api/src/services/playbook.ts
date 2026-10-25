import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  Concept, CreateConceptRequest, CreatePlaybookVersionRequest, CreateTermRequest, ExtractionStatus, ExtractionSummary, PatchConceptRequest, PatchTermRequest,
  PlaybookDocument, PlaybookPage, PlaybookVersion, SourceRef, Term, Unit,
} from '@footballos/contracts';
import type { Job } from '@footballos/media';
import type { AppContext } from '../context.js';
import type { Db } from '../db/db.js';
import { concepts, mediaAssets, playbookDocuments, playbookPages, playbookVersions, seasons, terms } from '../db/schema.js';
import { errors } from '../errors.js';
import type { ExtractDocumentResult, ProposeResult } from '../libs/index.js';
import { writeAudit } from './audit.js';
import { deleteAsset, type AssetRow, type DocumentJobInput, type DocumentRow } from './media.js';
import { keyFor } from './storage.js';

export type PageRow = typeof playbookPages.$inferSelect;
export type VersionRow = typeof playbookVersions.$inferSelect;
export type ConceptRow = typeof concepts.$inferSelect;
export type TermRow = typeof terms.$inferSelect;

/** What the hosted `extract_document` handler returns: C's extraction plus D's proposals. */
export type ExtractionJobResult = { extraction: ExtractDocumentResult; proposals: ProposeResult };

// Serialization ---------------------------------------------------------------------------------

export const serializeDocument = (d: DocumentRow): PlaybookDocument => ({
  id: d.id, teamId: d.teamId, unit: d.unit as Unit, title: d.title, assetId: d.assetId, pageCount: d.pageCount, status: d.status as PlaybookDocument['status'],
  extraction: d.extraction ?? null, createdBy: d.createdBy, createdAt: d.createdAt, updatedAt: d.updatedAt,
});

export const serializePage = (p: PageRow): PlaybookPage => ({
  id: p.id, documentId: p.documentId, pageNumber: p.pageNumber, imageKey: p.imageKey, ocrText: p.ocrText, ocrConfidence: p.ocrConfidence,
  textSource: p.textSource as PlaybookPage['textSource'], width: p.width, height: p.height,
});

export const serializeVersion = (v: VersionRow): PlaybookVersion => ({
  id: v.id, teamId: v.teamId, unit: v.unit as Unit, seasonId: v.seasonId, label: v.label, status: v.status as PlaybookVersion['status'],
  approvedBy: v.approvedBy, approvedAt: v.approvedAt, supersedes: v.supersedes, createdBy: v.createdBy, createdAt: v.createdAt,
});

export const serializeConcept = (c: ConceptRow): Concept => ({
  id: c.id, teamId: c.teamId, versionId: c.versionId, name: c.name, kind: c.kind as Concept['kind'], description: c.description, installed: c.installed,
  sources: c.sources, status: c.status as ExtractionStatus, basis: c.basis as Concept['basis'], note: c.note, decidedBy: c.decidedBy, decidedAt: c.decidedAt,
  version: c.version, createdAt: c.createdAt, updatedAt: c.updatedAt,
});

export const serializeTerm = (t: TermRow): Term => ({
  id: t.id, teamId: t.teamId, versionId: t.versionId, term: t.term, definition: t.definition, sources: t.sources, status: t.status as ExtractionStatus,
  basis: t.basis as Term['basis'], note: t.note, decidedBy: t.decidedBy, decidedAt: t.decidedAt, version: t.version, createdAt: t.createdAt, updatedAt: t.updatedAt,
});

// Documents -------------------------------------------------------------------------------------

export function getDocument(ctx: AppContext, id: string): DocumentRow | undefined {
  return ctx.db.select().from(playbookDocuments).where(eq(playbookDocuments.id, id)).get();
}

/** Team-scoped lookup: foreign or unknown is 404. */
export function requireDocument(ctx: AppContext, id: string, teamIds: string[]): DocumentRow {
  const d = getDocument(ctx, id);
  if (!d || !teamIds.includes(d.teamId)) throw errors.notFound('Playbook document');
  return d;
}

export function listDocuments(ctx: AppContext, teamId: string, unit?: Unit): DocumentRow[] {
  const where = unit ? and(eq(playbookDocuments.teamId, teamId), eq(playbookDocuments.unit, unit)) : eq(playbookDocuments.teamId, teamId);
  return ctx.db.select().from(playbookDocuments).where(where).orderBy(desc(playbookDocuments.createdAt)).all();
}

export function listPages(ctx: AppContext, documentId: string): PageRow[] {
  return ctx.db.select().from(playbookPages).where(eq(playbookPages.documentId, documentId)).orderBy(asc(playbookPages.pageNumber)).all();
}

export function getPage(ctx: AppContext, pageId: string): PageRow | undefined {
  return ctx.db.select().from(playbookPages).where(eq(playbookPages.id, pageId)).get();
}

/** Head-coach deletion: the file and page images go, the asset record stays `deleted`, concepts keep their source refs. */
export function deleteDocument(ctx: AppContext, actorUserId: string, doc: DocumentRow): void {
  const asset = ctx.db.select().from(mediaAssets).where(eq(mediaAssets.id, doc.assetId)).get();
  if (asset && asset.status !== 'deleted') deleteAsset(ctx, actorUserId, asset, 'asset.deleted');
  ctx.db.delete(playbookDocuments).where(eq(playbookDocuments.id, doc.id)).run();
  writeAudit(ctx, { teamId: doc.teamId, actorUserId, action: 'playbook.document_deleted', targetType: 'playbook_document', targetId: doc.id, details: { title: doc.title, unit: doc.unit, pageCount: doc.pageCount } });
}

// Extraction persistence (worker hook, inside the job's transaction) ---------------------------------

function seasonForProposals(tx: Db, teamId: string): string | null {
  const rows = tx.select().from(seasons).where(eq(seasons.teamId, teamId)).orderBy(desc(seasons.isCurrent), desc(seasons.startsOn)).all();
  return rows[0]?.id ?? null;
}

/** The draft version proposals go into: the newest draft of the unit, or a new one named after the document. */
function draftVersionForProposals(tx: Db, doc: DocumentRow, nowIso: string): VersionRow | null {
  const existing = tx
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.teamId, doc.teamId), eq(playbookVersions.unit, doc.unit), eq(playbookVersions.status, 'draft')))
    .orderBy(desc(playbookVersions.createdAt))
    .get();
  if (existing) return existing;
  const seasonId = seasonForProposals(tx, doc.teamId);
  if (!seasonId) return null;
  const row: VersionRow = {
    id: crypto.randomUUID(), teamId: doc.teamId, unit: doc.unit, seasonId, label: `Draft from ${doc.title}`.slice(0, 64), status: 'draft',
    approvedBy: null, approvedAt: null, supersedes: null, createdBy: doc.createdBy, createdAt: nowIso,
  };
  tx.insert(playbookVersions).values(row).run();
  return row;
}

/**
 * Persists an `extract_document` result: pages (image keys relative to the data dir, text,
 * `textSource`), the document summary, and every proposal as a `proposed` concept or term in the
 * unit's draft playbook version. Nothing is approved here.
 */
export function persistExtraction(ctx: AppContext, tx: Db, job: Job, result: ExtractionJobResult): void {
  const input = job.input as DocumentJobInput;
  const doc = tx.select().from(playbookDocuments).where(eq(playbookDocuments.id, input.documentId)).get();
  if (!doc) return;
  const nowIso = ctx.now().toISOString();
  tx.delete(playbookPages).where(eq(playbookPages.documentId, doc.id)).run();
  const pageIds = new Map<number, string>();
  for (const p of result.extraction.pages) {
    const id = crypto.randomUUID();
    pageIds.set(p.pageNumber, id);
    tx.insert(playbookPages).values({
      id, documentId: doc.id, pageNumber: p.pageNumber, imageKey: p.imagePath ? safeKey(ctx, p.imagePath) : null, ocrText: p.text, ocrConfidence: p.ocrConfidence,
      textSource: p.textSource, width: p.width, height: p.height,
    }).run();
  }
  const warnings = [...result.extraction.warnings];
  let conceptsProposed = 0;
  let termsProposed = 0;
  const total = result.proposals.concepts.length + result.proposals.terms.length;
  if (total > 0) {
    const version = draftVersionForProposals(tx, doc, nowIso);
    if (!version) {
      warnings.push('No season exists for this team, so the proposals could not be stored; create a season and re-run the extraction.');
    } else {
      // Re-running an extraction replaces only this document's proposals that no coach has decided.
      tx.delete(concepts).where(and(eq(concepts.documentId, doc.id), eq(concepts.status, 'proposed'))).run();
      tx.delete(terms).where(and(eq(terms.documentId, doc.id), eq(terms.status, 'proposed'))).run();
      const toSources = (src: { pageNumber: number; excerpt: string | null }[]): SourceRef[] =>
        src.map((s) => ({ documentId: doc.id, pageNumber: s.pageNumber, bbox: null, excerpt: s.excerpt ? s.excerpt.slice(0, 2000) : null }));
      for (const c of result.proposals.concepts) {
        tx.insert(concepts).values({
          id: crypto.randomUUID(), teamId: doc.teamId, versionId: version.id, documentId: doc.id, name: c.name.slice(0, 120), kind: c.kind, description: c.description.slice(0, 4000),
          installed: false, sources: toSources(c.sources), status: 'proposed', basis: c.basis, note: c.note.slice(0, 2000), decidedBy: null, decidedAt: null, version: 1, createdAt: nowIso, updatedAt: nowIso,
        }).run();
        conceptsProposed++;
      }
      for (const t of result.proposals.terms) {
        tx.insert(terms).values({
          id: crypto.randomUUID(), teamId: doc.teamId, versionId: version.id, documentId: doc.id, term: t.term.slice(0, 120), definition: t.definition.slice(0, 4000),
          sources: toSources(t.sources), status: 'proposed', basis: t.basis, note: t.note.slice(0, 2000), decidedBy: null, decidedAt: null, version: 1, createdAt: nowIso, updatedAt: nowIso,
        }).run();
        termsProposed++;
      }
    }
  }
  const summary: ExtractionSummary = {
    basis: result.proposals.basis, note: result.proposals.note, warnings, conceptsProposed, termsProposed,
    pagesWithoutText: result.extraction.pages.filter((p) => p.textSource === 'none').length,
  };
  tx.update(playbookDocuments)
    .set({ pageCount: result.extraction.pageCount, status: total > 0 ? 'review' : 'extracted', extraction: summary, updatedAt: nowIso })
    .where(eq(playbookDocuments.id, doc.id))
    .run();
}

function safeKey(ctx: AppContext, abs: string): string | null {
  try { return keyFor(ctx.config, abs); } catch { return null; }
}

export function markExtractionFailed(ctx: AppContext, tx: Db, job: Job, message: string): void {
  const input = job.input as DocumentJobInput;
  const doc = tx.select().from(playbookDocuments).where(eq(playbookDocuments.id, input.documentId)).get();
  if (!doc) return;
  const summary: ExtractionSummary = { basis: 'none', note: `Extraction failed: ${message}`, warnings: [], conceptsProposed: 0, termsProposed: 0, pagesWithoutText: 0 };
  tx.update(playbookDocuments).set({ status: 'failed', extraction: summary, updatedAt: ctx.now().toISOString() }).where(eq(playbookDocuments.id, doc.id)).run();
}

// Versions ---------------------------------------------------------------------------------------

export function getVersion(ctx: AppContext, id: string): VersionRow | undefined {
  return ctx.db.select().from(playbookVersions).where(eq(playbookVersions.id, id)).get();
}

export function requireVersion(ctx: AppContext, id: string, teamIds: string[]): VersionRow {
  const v = getVersion(ctx, id);
  if (!v || !teamIds.includes(v.teamId)) throw errors.notFound('Playbook version');
  return v;
}

export function listVersions(ctx: AppContext, teamId: string, q: { unit?: Unit; seasonId?: string }): VersionRow[] {
  const conds = [eq(playbookVersions.teamId, teamId)];
  if (q.unit) conds.push(eq(playbookVersions.unit, q.unit));
  if (q.seasonId) conds.push(eq(playbookVersions.seasonId, q.seasonId));
  return ctx.db.select().from(playbookVersions).where(and(...conds)).orderBy(desc(playbookVersions.createdAt)).all();
}

export function createVersion(ctx: AppContext, actorUserId: string, teamId: string, input: CreatePlaybookVersionRequest): VersionRow {
  const season = ctx.db.select().from(seasons).where(and(eq(seasons.id, input.seasonId), eq(seasons.teamId, teamId))).get();
  if (!season) throw errors.notFound('Season');
  const row: VersionRow = {
    id: crypto.randomUUID(), teamId, unit: input.unit, seasonId: input.seasonId, label: input.label, status: 'draft', approvedBy: null, approvedAt: null, supersedes: null,
    createdBy: actorUserId, createdAt: ctx.now().toISOString(),
  };
  ctx.db.insert(playbookVersions).values(row).run();
  writeAudit(ctx, { teamId, actorUserId, action: 'playbook.version_created', targetType: 'playbook_version', targetId: row.id, details: { unit: input.unit, seasonId: input.seasonId, label: input.label } });
  return row;
}

/** The approved playbook version of a unit for a season (the only one that grounds recommendations). */
export function approvedVersion(db: Db, teamId: string, unit: Unit, seasonId: string): VersionRow | undefined {
  return db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.teamId, teamId), eq(playbookVersions.unit, unit), eq(playbookVersions.seasonId, seasonId), eq(playbookVersions.status, 'approved')))
    .orderBy(desc(playbookVersions.approvedAt))
    .get();
}

/** Draft → approved; the previous approved version of the same unit and season becomes superseded. */
export function approveVersion(ctx: AppContext, actorUserId: string, v: VersionRow, override: boolean): { version: VersionRow; superseded: VersionRow | null } {
  if (v.status !== 'draft') throw errors.conflict(`Playbook version is ${v.status}, only a draft can be approved`, { currentStatus: v.status });
  const nowIso = ctx.now().toISOString();
  const previous = approvedVersion(ctx.db, v.teamId, v.unit as Unit, v.seasonId) ?? null;
  const next: VersionRow = { ...v, status: 'approved', approvedBy: actorUserId, approvedAt: nowIso, supersedes: previous?.id ?? null };
  ctx.db.transaction((tx) => {
    if (previous) tx.update(playbookVersions).set({ status: 'superseded' }).where(eq(playbookVersions.id, previous.id)).run();
    tx.update(playbookVersions).set({ status: 'approved', approvedBy: actorUserId, approvedAt: nowIso, supersedes: previous?.id ?? null }).where(eq(playbookVersions.id, v.id)).run();
    writeAudit(ctx, {
      teamId: v.teamId, actorUserId, action: 'playbook.approved', targetType: 'playbook_version', targetId: v.id,
      details: { unit: v.unit, seasonId: v.seasonId, label: v.label, supersedes: previous?.id ?? null, override, installedConcepts: countInstalled(tx, v.id) },
    });
  });
  return { version: next, superseded: previous ? { ...previous, status: 'superseded' } : null };
}

function countInstalled(db: Db, versionId: string): number {
  return db.select({ id: concepts.id }).from(concepts).where(and(eq(concepts.versionId, versionId), eq(concepts.status, 'approved'), eq(concepts.installed, true))).all().length;
}

// Concepts and terms --------------------------------------------------------------------------------

export function listConcepts(db: Db, versionId: string, status?: ExtractionStatus): ConceptRow[] {
  const where = status ? and(eq(concepts.versionId, versionId), eq(concepts.status, status)) : eq(concepts.versionId, versionId);
  return db.select().from(concepts).where(where).orderBy(asc(concepts.createdAt), asc(concepts.name)).all();
}

export function listTerms(db: Db, versionId: string, status?: ExtractionStatus): TermRow[] {
  const where = status ? and(eq(terms.versionId, versionId), eq(terms.status, status)) : eq(terms.versionId, versionId);
  return db.select().from(terms).where(where).orderBy(asc(terms.createdAt), asc(terms.term)).all();
}

/** Installed, approved concepts of a version: the only ones that ground recommendations (§15.1). */
export function installedConcepts(db: Db, versionId: string): ConceptRow[] {
  return db.select().from(concepts).where(and(eq(concepts.versionId, versionId), eq(concepts.status, 'approved'), eq(concepts.installed, true))).orderBy(asc(concepts.name)).all();
}

export function conceptsById(db: Db, ids: string[]): ConceptRow[] {
  return ids.length ? db.select().from(concepts).where(inArray(concepts.id, ids)).all() : [];
}

export function getConcept(ctx: AppContext, id: string): ConceptRow | undefined {
  return ctx.db.select().from(concepts).where(eq(concepts.id, id)).get();
}

export function getTerm(ctx: AppContext, id: string): TermRow | undefined {
  return ctx.db.select().from(terms).where(eq(terms.id, id)).get();
}

function requireDraftVersion(ctx: AppContext, versionId: string): VersionRow {
  const v = getVersion(ctx, versionId);
  if (!v) throw errors.notFound('Playbook version');
  if (v.status !== 'draft') throw errors.conflict(`Playbook version is ${v.status}; only drafts change`, { currentStatus: v.status, reason: 'not_draft' });
  return v;
}

export function patchConcept(ctx: AppContext, actorUserId: string, row: ConceptRow, patch: PatchConceptRequest): ConceptRow {
  if (patch.expectedVersion !== row.version) throw errors.conflict(`Concept version ${patch.expectedVersion} expected, current is ${row.version}`, { currentVersion: row.version });
  requireDraftVersion(ctx, row.versionId);
  const nowIso = ctx.now().toISOString();
  const decided = patch.status !== undefined && patch.status !== row.status;
  const next: ConceptRow = {
    ...row,
    name: patch.name ?? row.name, kind: patch.kind ?? row.kind, description: patch.description ?? row.description, installed: patch.installed ?? row.installed, note: patch.note ?? row.note,
    status: patch.status ?? row.status, decidedBy: decided ? actorUserId : row.decidedBy, decidedAt: decided ? nowIso : row.decidedAt, version: row.version + 1, updatedAt: nowIso,
  };
  // A rejected concept is never installed.
  if (next.status === 'rejected') next.installed = false;
  const res = ctx.db.update(concepts).set({ ...next }).where(and(eq(concepts.id, row.id), eq(concepts.version, row.version))).run();
  if (res.changes !== 1) throw errors.conflict('Concept changed concurrently', { currentVersion: getConcept(ctx, row.id)?.version ?? null });
  if (decided) {
    writeAudit(ctx, { teamId: row.teamId, actorUserId, action: 'playbook.extraction_decided', targetType: 'concept', targetId: row.id, details: { from: row.status, to: next.status, name: next.name, versionId: row.versionId } });
  }
  return next;
}

export function patchTerm(ctx: AppContext, actorUserId: string, row: TermRow, patch: PatchTermRequest): TermRow {
  if (patch.expectedVersion !== row.version) throw errors.conflict(`Term version ${patch.expectedVersion} expected, current is ${row.version}`, { currentVersion: row.version });
  requireDraftVersion(ctx, row.versionId);
  const nowIso = ctx.now().toISOString();
  const decided = patch.status !== undefined && patch.status !== row.status;
  const next: TermRow = {
    ...row, term: patch.term ?? row.term, definition: patch.definition ?? row.definition, note: patch.note ?? row.note, status: patch.status ?? row.status,
    decidedBy: decided ? actorUserId : row.decidedBy, decidedAt: decided ? nowIso : row.decidedAt, version: row.version + 1, updatedAt: nowIso,
  };
  const res = ctx.db.update(terms).set({ ...next }).where(and(eq(terms.id, row.id), eq(terms.version, row.version))).run();
  if (res.changes !== 1) throw errors.conflict('Term changed concurrently', { currentVersion: getTerm(ctx, row.id)?.version ?? null });
  if (decided) {
    writeAudit(ctx, { teamId: row.teamId, actorUserId, action: 'playbook.extraction_decided', targetType: 'term', targetId: row.id, details: { from: row.status, to: next.status, term: next.term, versionId: row.versionId } });
  }
  return next;
}

/** Coach-created concept: approved at once, no sources, `basis: 'none'`. */
export function createConcept(ctx: AppContext, actorUserId: string, version: VersionRow, input: CreateConceptRequest): ConceptRow {
  requireDraftVersion(ctx, version.id);
  const nowIso = ctx.now().toISOString();
  const row: ConceptRow = {
    id: crypto.randomUUID(), teamId: version.teamId, versionId: version.id, documentId: null, name: input.name, kind: input.kind, description: input.description, installed: input.installed,
    sources: [], status: 'approved', basis: 'none', note: input.note, decidedBy: actorUserId, decidedAt: nowIso, version: 1, createdAt: nowIso, updatedAt: nowIso,
  };
  ctx.db.insert(concepts).values(row).run();
  return row;
}

export function createTerm(ctx: AppContext, actorUserId: string, version: VersionRow, input: CreateTermRequest): TermRow {
  requireDraftVersion(ctx, version.id);
  const nowIso = ctx.now().toISOString();
  const row: TermRow = {
    id: crypto.randomUUID(), teamId: version.teamId, versionId: version.id, documentId: null, term: input.term, definition: input.definition, sources: [], status: 'approved',
    basis: 'none', note: input.note, decidedBy: actorUserId, decidedAt: nowIso, version: 1, createdAt: nowIso, updatedAt: nowIso,
  };
  ctx.db.insert(terms).values(row).run();
  return row;
}

export type { AssetRow };
