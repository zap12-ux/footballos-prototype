import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWorkerUntilIdle } from '../jobs/worker.js';
import { listAuditByActions } from '../services/teams.js';
import { call, makeTestApp, seedTeamWithStaff, type TestApp } from './helpers.js';
import { makePlaybookPdf, PLAYBOOK_TXT, uploadDocument } from './coaching-helpers.js';

let t: TestApp;
let f: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let other: Awaited<ReturnType<typeof seedTeamWithStaff>>;
beforeAll(async () => {
  t = makeTestApp();
  f = await seedTeamWithStaff(t, 'Playbook (demo)');
  other = await seedTeamWithStaff(t, 'Rival (demo)');
});
afterAll(() => t.close());

const api = (p: string) => `/api/v1${p}`;

describe('§15.1 playbook intake', () => {
  let txtDocId: string;
  let pdfDocId: string;
  let draftVersionId: string;

  it('uploads a .txt document at team level, extracts pages and proposes concepts and terms', async () => {
    const up = await uploadDocument(t, f.oc.cookie, f.team.id, 'install-1.txt', Buffer.from(PLAYBOOK_TXT, 'utf8'), 'offense');
    expect(up.create.status).toBe(201);
    expect(up.create.body.asset.kind).toBe('document');
    expect(up.create.body.asset.gameId).toBeNull();
    expect(up.create.body.document).toMatchObject({ unit: 'offense', title: 'install-1', status: 'uploaded', pageCount: 0 });
    txtDocId = up.create.body.document.id;
    expect(up.complete.status).toBe(200);
    expect(up.complete.body.jobs.map((j: any) => j.kind)).toEqual(['extract_document']);
    const done = await runWorkerUntilIdle(t.ctx);
    expect(done.map((j) => [j.kind, j.status, j.error?.message])).toEqual([['extract_document', 'succeeded', undefined]]);
    const detail = await call(t, 'GET', api(`/playbook/documents/${txtDocId}`), undefined, f.vw.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.document.status).toBe('review');
    expect(detail.body.document.pageCount).toBe(1);
    expect(detail.body.pages).toHaveLength(1);
    expect(detail.body.pages[0]).toMatchObject({ pageNumber: 1, textSource: 'pdf_text' });
    expect(detail.body.pages[0].ocrText).toContain('Outside Zone Left');
    expect(detail.body.document.extraction.basis).toBe('text');
    expect(detail.body.document.extraction.conceptsProposed).toBeGreaterThanOrEqual(2);
    expect(detail.body.document.extraction.termsProposed).toBeGreaterThanOrEqual(1);

    const versions = await call(t, 'GET', api(`/teams/${f.team.id}/playbook/versions?unit=offense`), undefined, f.vw.cookie);
    expect(versions.status).toBe(200);
    expect(versions.body.items).toHaveLength(1);
    expect(versions.body.items[0].status).toBe('draft');
    draftVersionId = versions.body.items[0].id;
    const concepts = await call(t, 'GET', api(`/playbook/versions/${draftVersionId}/concepts?status=proposed`), undefined, f.vw.cookie);
    expect(concepts.status).toBe(200);
    const names = concepts.body.items.map((c: any) => c.name);
    expect(names).toContain('Outside Zone Left');
    expect(names).toContain('Trap Right');
    for (const c of concepts.body.items) {
      expect(c.status).toBe('proposed');
      expect(c.installed).toBe(false);
      expect(c.basis).toBe('text');
      expect(c.sources[0]).toMatchObject({ documentId: txtDocId, pageNumber: 1, bbox: null });
      expect(typeof c.sources[0].excerpt).toBe('string');
    }
    const terms = await call(t, 'GET', api(`/playbook/versions/${draftVersionId}/terms`), undefined, f.vw.cookie);
    expect(terms.body.items.map((x: any) => x.term)).toEqual(expect.arrayContaining(['Trips']));
    expect(terms.body.items.every((x: any) => x.status === 'proposed')).toBe(true);
  });

  it('uploads a generated text PDF: pages carry the text layer, page images are served through a grant', async () => {
    const pdf = await makePlaybookPdf();
    const up = await uploadDocument(t, f.hc.cookie, f.team.id, 'Install 2.pdf', pdf, 'offense', { title: 'Install 2' });
    expect(up.create.status).toBe(201);
    pdfDocId = up.create.body.document.id;
    expect(up.complete.status).toBe(200);
    const done = await runWorkerUntilIdle(t.ctx);
    expect(done.map((j) => [j.kind, j.status, j.error?.message])).toEqual([['extract_document', 'succeeded', undefined]]);
    const detail = await call(t, 'GET', api(`/playbook/documents/${pdfDocId}`), undefined, f.an.cookie);
    expect(detail.body.document.pageCount).toBe(3);
    expect(detail.body.pages.map((p: any) => p.textSource)).toEqual(['pdf_text', 'pdf_text', 'pdf_text']);
    expect(detail.body.pages[0].ocrText).toContain('Inside Zone Right');
    expect(detail.body.pages[0].width).toBeGreaterThan(100);
    const concepts = await call(t, 'GET', api(`/playbook/versions/${draftVersionId}/concepts`), undefined, f.vw.cookie);
    const names = concepts.body.items.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Inside Zone Right', 'Power Right', 'Four Verts']));
    const terms = await call(t, 'GET', api(`/playbook/versions/${draftVersionId}/terms`), undefined, f.vw.cookie);
    expect(terms.body.items.map((x: any) => x.term)).toEqual(expect.arrayContaining(['Rip', 'Trips']));
    // Proposals point at the PDF's own pages.
    const rip = terms.body.items.find((x: any) => x.term === 'Rip');
    expect(rip.sources[0]).toMatchObject({ documentId: pdfDocId, pageNumber: 3 });

    const grant = await call(t, 'GET', api(`/playbook/documents/${pdfDocId}/grant`), undefined, f.vw.cookie);
    expect(grant.status).toBe(200);
    const url = (grant.body.pageUrlTemplate as string).replace('{pageId}', detail.body.pages[0].id);
    const img = await t.app.request(url);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(img.headers.get('content-security-policy')).toBe("default-src 'none'");
    const bytes = Buffer.from(await img.arrayBuffer());
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    // Without a token, or with a token for another document, nothing is served.
    expect((await t.app.request(url.split('?')[0]!)).status).toBe(401);
    const list = await call(t, 'GET', api(`/teams/${f.team.id}/playbook/documents?unit=offense`), undefined, f.vw.cookie);
    expect(list.body.items).toHaveLength(2);
    // Viewers cannot upload; the other team cannot see the document.
    expect((await call(t, 'POST', api(`/teams/${f.team.id}/playbook/documents`), { filename: 'x.pdf', byteSize: 10, mimeType: 'application/pdf', unit: 'offense' }, f.vw.cookie)).status).toBe(403);
    expect((await call(t, 'GET', api(`/playbook/documents/${pdfDocId}`), undefined, other.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', api(`/playbook/documents/${pdfDocId}/grant`), undefined, other.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', api(`/teams/${f.team.id}/playbook/documents`), undefined, other.hc.cookie)).status).toBe(404);
  });

  it('rejects unsupported document types and film-style uploads without a unit', async () => {
    const bad = await call(t, 'POST', api(`/teams/${f.team.id}/playbook/documents`), { filename: 'plays.exe', byteSize: 10, mimeType: 'application/octet-stream', unit: 'offense' }, f.hc.cookie);
    expect(bad.status).toBe(400);
    const noUnit = await call(t, 'POST', api(`/teams/${f.team.id}/playbook/documents`), { filename: 'plays.pdf', byteSize: 10, mimeType: 'application/pdf' }, f.hc.cookie);
    expect(noUnit.status).toBe(400);
  });

  it('approves a concept (coordinator of the unit), rejects position coach and viewer, keeps rejected concepts uninstalled', async () => {
    const concepts = (await call(t, 'GET', api(`/playbook/versions/${draftVersionId}/concepts`), undefined, f.oc.cookie)).body.items;
    const zone = concepts.find((c: any) => c.name === 'Inside Zone Right');
    const pcTry = await call(t, 'PATCH', api(`/concepts/${zone.id}`), { expectedVersion: zone.version, status: 'approved', installed: true }, f.pc.cookie);
    expect(pcTry.status).toBe(403);
    expect((await call(t, 'PATCH', api(`/concepts/${zone.id}`), { expectedVersion: zone.version, status: 'approved' }, f.vw.cookie)).status).toBe(403);
    expect((await call(t, 'PATCH', api(`/concepts/${zone.id}`), { expectedVersion: zone.version, status: 'approved' }, other.hc.cookie)).status).toBe(404);
    const stale = await call(t, 'PATCH', api(`/concepts/${zone.id}`), { expectedVersion: 9, status: 'approved' }, f.oc.cookie);
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentVersion).toBe(zone.version);
    const ok = await call(t, 'PATCH', api(`/concepts/${zone.id}`), { expectedVersion: zone.version, status: 'approved', installed: true, kind: 'run', description: 'Base inside zone' }, f.oc.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.concept).toMatchObject({ status: 'approved', installed: true, kind: 'run', version: zone.version + 1, decidedBy: f.oc.user.id });
    const power = concepts.find((c: any) => c.name === 'Power Right');
    const rejected = await call(t, 'PATCH', api(`/concepts/${power.id}`), { expectedVersion: power.version, status: 'rejected', installed: true }, f.hc.cookie);
    expect(rejected.status).toBe(200);
    expect(rejected.body.concept).toMatchObject({ status: 'rejected', installed: false });
    const audits = listAuditByActions(t.ctx, f.team.id, ['playbook.extraction_decided']);
    expect(audits.length).toBe(2);
    // Coach-created concept: approved, no sources.
    const created = await call(t, 'POST', api(`/playbook/versions/${draftVersionId}/concepts`), { name: 'Quarters', kind: 'coverage', installed: true }, f.oc.cookie);
    expect(created.status).toBe(201);
    expect(created.body.concept).toMatchObject({ status: 'approved', installed: true, sources: [], basis: 'none' });
    const terms = (await call(t, 'GET', api(`/playbook/versions/${draftVersionId}/terms`), undefined, f.oc.cookie)).body.items;
    const rip = terms.find((x: any) => x.term === 'Rip');
    const t2 = await call(t, 'PATCH', api(`/terms/${rip.id}`), { expectedVersion: rip.version, status: 'approved' }, f.oc.cookie);
    expect(t2.status).toBe(200);
    expect(t2.body.term.status).toBe('approved');
  });

  it('approves the version, then a later approval supersedes it; only drafts change', async () => {
    expect((await call(t, 'POST', api(`/playbook/versions/${draftVersionId}/approve`), undefined, f.pc.cookie)).status).toBe(403);
    const approve = await call(t, 'POST', api(`/playbook/versions/${draftVersionId}/approve`), undefined, f.oc.cookie);
    expect(approve.status).toBe(200);
    expect(approve.body.version).toMatchObject({ status: 'approved', approvedBy: f.oc.user.id, supersedes: null });
    expect(approve.body.superseded).toBeNull();
    const again = await call(t, 'POST', api(`/playbook/versions/${draftVersionId}/approve`), undefined, f.oc.cookie);
    expect(again.status).toBe(409);
    const concepts = (await call(t, 'GET', api(`/playbook/versions/${draftVersionId}/concepts?status=proposed`), undefined, f.oc.cookie)).body.items;
    const frozen = await call(t, 'PATCH', api(`/concepts/${concepts[0].id}`), { expectedVersion: concepts[0].version, status: 'approved' }, f.oc.cookie);
    expect(frozen.status).toBe(409);
    expect(frozen.body.error.details.reason).toBe('not_draft');

    const v2 = await call(t, 'POST', api(`/teams/${f.team.id}/playbook/versions`), { unit: 'offense', seasonId: f.season.id, label: 'Week 3 install' }, f.hc.cookie);
    expect(v2.status).toBe(201);
    expect((await call(t, 'POST', api(`/teams/${f.team.id}/playbook/versions`), { unit: 'offense', seasonId: f.season.id, label: 'x' }, f.pc.cookie)).status).toBe(403);
    const approve2 = await call(t, 'POST', api(`/playbook/versions/${v2.body.version.id}/approve`), undefined, f.hc.cookie);
    expect(approve2.status).toBe(200);
    expect(approve2.body.version.supersedes).toBe(draftVersionId);
    expect(approve2.body.superseded).toMatchObject({ id: draftVersionId, status: 'superseded' });
    const list = await call(t, 'GET', api(`/teams/${f.team.id}/playbook/versions?unit=offense`), undefined, f.vw.cookie);
    expect(list.body.items.map((v: any) => v.status).sort()).toEqual(['approved', 'superseded']);
    expect(listAuditByActions(t.ctx, f.team.id, ['playbook.approved']).length).toBe(2);
  });

  it('head coach deletes a document: pages go, record is gone, concepts keep their source refs', async () => {
    expect((await call(t, 'DELETE', api(`/playbook/documents/${txtDocId}`), undefined, f.oc.cookie)).status).toBe(403);
    expect((await call(t, 'DELETE', api(`/playbook/documents/${txtDocId}`), undefined, other.hc.cookie)).status).toBe(404);
    const del = await call(t, 'DELETE', api(`/playbook/documents/${txtDocId}`), undefined, f.hc.cookie);
    expect(del.status).toBe(204);
    expect((await call(t, 'GET', api(`/playbook/documents/${txtDocId}`), undefined, f.hc.cookie)).status).toBe(404);
    const concepts = (await call(t, 'GET', api(`/playbook/versions/${draftVersionId}/concepts`), undefined, f.hc.cookie)).body.items;
    expect(concepts.some((c: any) => c.sources[0]?.documentId === txtDocId)).toBe(true);
    expect(listAuditByActions(t.ctx, f.team.id, ['playbook.document_deleted']).length).toBe(1);
  });
});
