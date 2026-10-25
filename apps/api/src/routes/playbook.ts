import fs from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  CreateConceptRequestSchema, CreateDocumentUploadRequestSchema, CreatePlaybookVersionRequestSchema, CreateTermRequestSchema, ExtractionStatusQuerySchema, IdSchema,
  PatchConceptRequestSchema, PatchTermRequestSchema, PlaybookDocumentsQuerySchema, PlaybookVersionsQuerySchema, type ApprovePlaybookVersionResponse, type DocumentGrant,
  type PlaybookDocumentDetail, type Unit,
} from '@footballos/contracts';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { zv } from '../http/validate.js';
import { API_PREFIX } from '../http/prefix.js';
import { assert, policy, requireAuth, requireMembership, type AppEnv } from '../http/guards.js';
import { teamIdsOf } from './media.js';
import { createUpload, getAsset, serializeAsset, serializeUpload } from '../services/media.js';
import { signGrant, verifyGrant } from '../services/grants.js';
import { absolutePath } from '../services/storage.js';
import {
  approveVersion, createConcept, createTerm, createVersion, deleteDocument, getConcept, getDocument, getPage, getTerm, listConcepts, listDocuments, listPages, listTerms, listVersions,
  patchConcept, patchTerm, requireDocument, requireVersion, serializeConcept, serializeDocument, serializePage, serializeTerm, serializeVersion,
} from '../services/playbook.js';

const teamParam = z.object({ teamId: IdSchema });
const idParam = z.object({ id: IdSchema });

/** §15.1 playbook intake and review (authenticated). */
export function playbookRoutes(ctx: AppContext) {
  return new Hono<AppEnv>()
    .use('*', requireAuth(ctx))
    // Documents --------------------------------------------------------------------------------
    .post('/teams/:teamId/playbook/documents', zv('param', teamParam), zv('json', CreateDocumentUploadRequestSchema), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      assert(policy.canUploadOrCorrect(m), 'Viewers cannot upload playbook documents');
      const body = c.req.valid('json');
      const r = createUpload(ctx, c.var.auth.user.id, teamId, null, { ...body, kind: 'document' });
      return c.json({ document: serializeDocument(r.document!), upload: serializeUpload(r.upload), asset: serializeAsset(r.asset) }, 201);
    })
    .get('/teams/:teamId/playbook/documents', zv('param', teamParam), zv('query', PlaybookDocumentsQuerySchema), (c) => {
      const { teamId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      return c.json({ items: listDocuments(ctx, teamId, c.req.valid('query').unit).map(serializeDocument) }, 200);
    })
    .get('/playbook/documents/:id', zv('param', idParam), (c) => {
      const d = requireDocument(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, d.teamId);
      const body: PlaybookDocumentDetail = { document: serializeDocument(d), pages: listPages(ctx, d.id).map(serializePage) };
      return c.json(body, 200);
    })
    .get('/playbook/documents/:id/grant', zv('param', idParam), (c) => {
      const d = requireDocument(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, d.teamId);
      const expiresAtMs = ctx.now().getTime() + ctx.config.limits.mediaGrantTtlMin * 60_000;
      const token = signGrant(ctx, { teamId: d.teamId, assetId: d.assetId, expiresAtMs });
      const body: DocumentGrant = { pageUrlTemplate: `${API_PREFIX}/playbook/pages/{pageId}/image?token=${encodeURIComponent(token)}`, expiresAt: new Date(expiresAtMs).toISOString() };
      return c.json(body, 200);
    })
    .delete('/playbook/documents/:id', zv('param', idParam), (c) => {
      const d = requireDocument(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, d.teamId);
      assert(policy.canManageTeam(m), 'Only the head coach deletes playbook documents');
      deleteDocument(ctx, c.var.auth.user.id, d);
      return c.body(null, 204);
    })
    // Versions ---------------------------------------------------------------------------------
    .get('/teams/:teamId/playbook/versions', zv('param', teamParam), zv('query', PlaybookVersionsQuerySchema), (c) => {
      const { teamId } = c.req.valid('param');
      requireMembership(c.var.auth, teamId);
      return c.json({ items: listVersions(ctx, teamId, c.req.valid('query')).map(serializeVersion) }, 200);
    })
    .post('/teams/:teamId/playbook/versions', zv('param', teamParam), zv('json', CreatePlaybookVersionRequestSchema), (c) => {
      const { teamId } = c.req.valid('param');
      const m = requireMembership(c.var.auth, teamId);
      const body = c.req.valid('json');
      assert(policy.canApproveExtraction(m, body.unit), 'Coordinator of the unit or head coach required');
      return c.json({ version: serializeVersion(createVersion(ctx, c.var.auth.user.id, teamId, body)) }, 201);
    })
    .get('/playbook/versions/:id', zv('param', idParam), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, v.teamId);
      return c.json({ version: serializeVersion(v) }, 200);
    })
    .get('/playbook/versions/:id/concepts', zv('param', idParam), zv('query', ExtractionStatusQuerySchema), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, v.teamId);
      return c.json({ items: listConcepts(ctx.db, v.id, c.req.valid('query').status).map(serializeConcept) }, 200);
    })
    .get('/playbook/versions/:id/terms', zv('param', idParam), zv('query', ExtractionStatusQuerySchema), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      requireMembership(c.var.auth, v.teamId);
      return c.json({ items: listTerms(ctx.db, v.id, c.req.valid('query').status).map(serializeTerm) }, 200);
    })
    .post('/playbook/versions/:id/concepts', zv('param', idParam), zv('json', CreateConceptRequestSchema), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, v.teamId);
      assert(policy.canApproveExtraction(m, v.unit as Unit), 'Coordinator of the unit or head coach required');
      return c.json({ concept: serializeConcept(createConcept(ctx, c.var.auth.user.id, v, c.req.valid('json'))) }, 201);
    })
    .post('/playbook/versions/:id/terms', zv('param', idParam), zv('json', CreateTermRequestSchema), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, v.teamId);
      assert(policy.canApproveExtraction(m, v.unit as Unit), 'Coordinator of the unit or head coach required');
      return c.json({ term: serializeTerm(createTerm(ctx, c.var.auth.user.id, v, c.req.valid('json'))) }, 201);
    })
    .post('/playbook/versions/:id/approve', zv('param', idParam), (c) => {
      const v = requireVersion(ctx, c.req.valid('param').id, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, v.teamId);
      assert(policy.canApproveExtraction(m, v.unit as Unit), 'Coordinator of the unit or head coach required');
      const r = approveVersion(ctx, c.var.auth.user.id, v, m.role === 'head_coach');
      const body: ApprovePlaybookVersionResponse = { version: serializeVersion(r.version), superseded: r.superseded ? serializeVersion(r.superseded) : null };
      return c.json(body, 200);
    })
    // Concepts and terms -------------------------------------------------------------------------
    .patch('/concepts/:id', zv('param', idParam), zv('json', PatchConceptRequestSchema), (c) => {
      const row = getConcept(ctx, c.req.valid('param').id);
      if (!row || !teamIdsOf(c.var.auth).includes(row.teamId)) throw errors.notFound('Concept');
      const v = requireVersion(ctx, row.versionId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, row.teamId);
      assert(policy.canApproveExtraction(m, v.unit as Unit), 'Coordinator of the unit or head coach required');
      return c.json({ concept: serializeConcept(patchConcept(ctx, c.var.auth.user.id, row, c.req.valid('json'))) }, 200);
    })
    .patch('/terms/:id', zv('param', idParam), zv('json', PatchTermRequestSchema), (c) => {
      const row = getTerm(ctx, c.req.valid('param').id);
      if (!row || !teamIdsOf(c.var.auth).includes(row.teamId)) throw errors.notFound('Term');
      const v = requireVersion(ctx, row.versionId, teamIdsOf(c.var.auth));
      const m = requireMembership(c.var.auth, row.teamId);
      assert(policy.canApproveExtraction(m, v.unit as Unit), 'Coordinator of the unit or head coach required');
      return c.json({ term: serializeTerm(patchTerm(ctx, c.var.auth.user.id, row, c.req.valid('json'))) }, 200);
    });
}

const pageParam = z.object({ pageId: IdSchema });
const tokenQuery = z.object({ token: z.string().min(1).optional() });

/** §15.1 page images through a document grant (token-authenticated, no session). */
export function playbookPageRoutes(ctx: AppContext) {
  return new Hono().get('/playbook/pages/:pageId/image', zv('param', pageParam), zv('query', tokenQuery), (c) => {
    const page = getPage(ctx, c.req.valid('param').pageId);
    if (!page) throw errors.notFound('Page');
    const doc = getDocument(ctx, page.documentId);
    if (!doc) throw errors.notFound('Page');
    const claims = verifyGrant(ctx, c.req.valid('query').token, doc.assetId);
    if (!claims || claims.teamId !== doc.teamId) throw errors.unauthorized('Document grant is missing, invalid or expired');
    const asset = getAsset(ctx, doc.assetId);
    if (!asset || asset.status === 'deleted' || !page.imageKey) throw errors.notFound('Page image');
    const file = absolutePath(ctx.config, page.imageKey);
    if (!fs.existsSync(file)) throw errors.notFound('Page image');
    const bytes = fs.readFileSync(file);
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `inline; filename="${page.id}.png"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'private, no-store',
    });
  });
}
