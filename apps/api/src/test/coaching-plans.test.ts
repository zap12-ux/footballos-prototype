import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { listAuditByActions } from '../services/teams.js';
import { call, makeTestApp, seedTeamWithStaff, signIn, type TestApp } from './helpers.js';
import { seedGame } from './media-helpers.js';
import { addDefensiveCoordinator, seedOpponentFilm } from './coaching-helpers.js';

let t: TestApp;
let f: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let other: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let dc: Awaited<ReturnType<typeof addDefensiveCoordinator>>;
let gameId: string;
let film: ReturnType<typeof seedOpponentFilm>;
beforeAll(async () => {
  t = makeTestApp();
  f = await seedTeamWithStaff(t, 'Plans (demo)');
  other = await seedTeamWithStaff(t, 'Elsewhere (demo)');
  dc = await addDefensiveCoordinator(t, f.team.id, 'plans');
  gameId = (await seedGame(t, f.hc.cookie, f.team.id, f.season.id, 'Riverbend Otters (demo)')).gameId;
});
afterAll(() => t.close());

const api = (p: string) => `/api/v1${p}`;
const season = () => api(`/teams/${f.team.id}/seasons/${f.season.id}`);

describe('§15.3 recommendations and §15.4 unit plans', () => {
  let conceptIds: string[] = [];
  let recs: any[] = [];
  let planVersionId: string;
  let acceptedItemId: string;
  let approvedId: string;

  it('generation is blocked, with reasons, until playbook, personnel and reviewed film exist', async () => {
    const blocked = await call(t, 'POST', api(`/games/${gameId}/recommendations/generate`), { unit: 'defense' }, dc.cookie);
    expect(blocked.status).toBe(201);
    expect(blocked.body.items).toEqual([]);
    expect(blocked.body.blockedReasons).toEqual(expect.arrayContaining([expect.stringMatching(/no approved playbook/), expect.stringMatching(/no personnel/), expect.stringMatching(/no scouting findings/)]));
    expect(blocked.body.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    // Offense coordinator cannot generate for the defense; position coach and viewer neither; other team 404.
    expect((await call(t, 'POST', api(`/games/${gameId}/recommendations/generate`), { unit: 'defense' }, f.oc.cookie)).status).toBe(403);
    expect((await call(t, 'POST', api(`/games/${gameId}/recommendations/generate`), { unit: 'defense' }, f.pc.cookie)).status).toBe(403);
    expect((await call(t, 'POST', api(`/games/${gameId}/recommendations/generate`), { unit: 'defense' }, other.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', api(`/games/${gameId}/recommendations`), undefined, other.hc.cookie)).status).toBe(404);
  });

  it('with an approved defensive playbook, personnel and reviewed opponent film, generation grounds items', async () => {
    const version = (await call(t, 'POST', api(`/teams/${f.team.id}/playbook/versions`), { unit: 'defense', seasonId: f.season.id, label: 'Base D' }, dc.cookie)).body.version;
    for (const [name, kind] of [['Over Front', 'front'], ['Cover 3', 'coverage'], ['Field Pressure', 'pressure']] as const) {
      const c = await call(t, 'POST', api(`/playbook/versions/${version.id}/concepts`), { name, kind, installed: true }, dc.cookie);
      expect(c.status).toBe(201);
      conceptIds.push(c.body.concept.id);
    }
    expect((await call(t, 'POST', api(`/playbook/versions/${version.id}/approve`), undefined, dc.cookie)).status).toBe(200);
    const p1 = (await call(t, 'POST', `${season()}/players`, { jersey: '44', firstName: 'Mike', lastName: 'Backer', positions: ['LB'] }, f.hc.cookie)).body.player;
    const p2 = (await call(t, 'POST', `${season()}/players`, { jersey: '2', firstName: 'Nickel', lastName: 'Corner', positions: ['CB'], availability: [{ week: 1, status: 'out', note: 'concussion protocol' }] }, f.hc.cookie)).body.player;
    expect((await call(t, 'POST', `${season()}/packages`, { unit: 'defense', name: 'Base', playerIds: [p1.id] }, dc.cookie)).status).toBe(201);
    expect((await call(t, 'POST', `${season()}/packages`, { unit: 'defense', name: 'Nickel', playerIds: [p1.id, p2.id] }, dc.cookie)).status).toBe(201);
    film = seedOpponentFilm(t, f.team.id, gameId, f.an.user.id, { n: 6, runs: 5 });

    const gen = await call(t, 'POST', api(`/games/${gameId}/recommendations/generate`), { unit: 'defense' }, dc.cookie);
    expect(gen.status).toBe(201);
    expect(gen.body.blockedReasons).toEqual([]);
    expect(gen.body.items.length).toBeGreaterThanOrEqual(1);
    recs = gen.body.items;
    for (const r of recs) {
      expect(r).toMatchObject({ unit: 'defense', gameId, status: 'proposed', storedStatus: 'proposed', staleReason: null, decidedBy: null });
      expect(r.counts.length).toBeGreaterThan(0);
      expect(r.limitations.length).toBeGreaterThan(0);
      expect(r.supportingFindings.length).toBeGreaterThan(0);
      for (const id of r.playbookConceptIds) expect(conceptIds).toContain(id);
    }
    // The Nickel package has a player out for week 1 and is never referenced.
    const nickel = gen.body.packages.find((p: any) => p.name === 'Nickel');
    expect(nickel.available).toBe(false);
    expect(recs.every((r) => !r.personnelPackageIds.includes(nickel.packageId))).toBe(true);
    expect(listAuditByActions(t.ctx, f.team.id, ['recommendation.generated']).length).toBe(2);
    const list = await call(t, 'GET', api(`/games/${gameId}/recommendations?unit=defense`), undefined, f.vw.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((r: any) => r.id).sort()).toEqual(recs.map((r) => r.id).sort());
  });

  it('a label correction makes the items stale on read without touching the stored decision; regeneration supersedes undecided items', async () => {
    const labelId = film.labelIds[5]!.play_type!;
    const label = (await call(t, 'GET', api(`/segments/${film.segmentIds[5]}/labels`), undefined, f.an.cookie)).body.items.find((l: any) => l.id === labelId);
    const fix = await call(t, 'PATCH', api(`/labels/${labelId}`), { accepted: { value: 'run', status: 'corrected' }, reason: 'it was a draw', expectedVersion: label.version }, f.an.cookie);
    expect(fix.status).toBe(200);
    const list = await call(t, 'GET', api(`/games/${gameId}/recommendations?unit=defense`), undefined, f.vw.cookie);
    for (const r of list.body.items) {
      expect(r.status).toBe('stale');
      expect(r.staleReason).toMatch(/film labels/);
      expect(r.storedStatus).toBe('proposed');
    }
    const regen = await call(t, 'POST', api(`/games/${gameId}/recommendations/generate`), { unit: 'defense' }, f.hc.cookie);
    expect(regen.status).toBe(201);
    expect(regen.body.supersededIds.sort()).toEqual(recs.map((r) => r.id).sort());
    expect(regen.body.items.length).toBeGreaterThanOrEqual(1);
    const after = await call(t, 'GET', api(`/games/${gameId}/recommendations?unit=defense`), undefined, f.vw.cookie);
    const old = after.body.items.filter((r: any) => recs.some((o) => o.id === r.id));
    expect(old.every((r: any) => r.status === 'rejected' && r.staleReason === 'regenerated')).toBe(true);
    recs = regen.body.items;
    expect(recs.every((r) => r.status === 'proposed')).toBe(true);
  });

  it('decisions: accept and edit create items in the current draft plan; reject and defer do not; superseded items cannot be decided', async () => {
    const [a, b, ...rest] = recs;
    expect((await call(t, 'POST', api(`/recommendations/${a.id}/decide`), { decision: 'accept' }, f.oc.cookie)).status).toBe(403);
    expect((await call(t, 'POST', api(`/recommendations/${a.id}/decide`), { decision: 'accept' }, other.hc.cookie)).status).toBe(404);
    expect((await call(t, 'POST', api(`/recommendations/${a.id}/decide`), { decision: 'edit' }, dc.cookie)).status).toBe(400);
    const accept = await call(t, 'POST', api(`/recommendations/${a.id}/decide`), { decision: 'accept', note: 'good call' }, dc.cookie);
    expect(accept.status).toBe(200);
    expect(accept.body.recommendation).toMatchObject({ status: 'accepted', storedStatus: 'accepted', decidedBy: dc.user.id, decisionNote: 'good call' });
    expect(accept.body.planVersionId).toBeTruthy();
    expect(accept.body.planItemId).toBeTruthy();
    planVersionId = accept.body.planVersionId;
    acceptedItemId = accept.body.planItemId;
    expect((await call(t, 'POST', api(`/recommendations/${a.id}/decide`), { decision: 'reject' }, dc.cookie)).status).toBe(409);
    if (b) {
      const edit = await call(t, 'POST', api(`/recommendations/${b.id}/decide`), { decision: 'edit', editedStatement: 'Walk the nickel down against trips and spill the run.' }, dc.cookie);
      expect(edit.status).toBe(200);
      expect(edit.body.recommendation).toMatchObject({ status: 'edited', editedStatement: 'Walk the nickel down against trips and spill the run.' });
      expect(edit.body.planVersionId).toBe(planVersionId);
    }
    const plan = await call(t, 'GET', api(`/games/${gameId}/plans/defense`), undefined, f.vw.cookie);
    expect(plan.status).toBe(200);
    expect(plan.body.current.id).toBe(planVersionId);
    expect(plan.body.current.status).toBe('draft');
    expect(plan.body.current.number).toBe(1);
    expect(plan.body.versions).toHaveLength(1);
    const items = plan.body.current.sections.flatMap((s: any) => s.items);
    expect(items.find((i: any) => i.id === acceptedItemId)).toMatchObject({ sourceRecommendationId: a.id, text: a.statement });
    if (b) expect(items.find((i: any) => i.sourceRecommendationId === b.id).text).toBe('Walk the nickel down against trips and spill the run.');
    expect(plan.body.current.sections.map((s: any) => s.key)).toEqual(['opponent_tendencies', 'fronts', 'fits', 'coverages', 'pressures', 'matchups', 'third_down', 'red_zone', 'short_yardage', 'two_minute']);
    for (const r of rest) expect((await call(t, 'POST', api(`/recommendations/${r.id}/decide`), { decision: 'defer' }, dc.cookie)).body.recommendation.status).toBe('deferred');
    const superseded = (await call(t, 'GET', api(`/games/${gameId}/recommendations?unit=defense`), undefined, dc.cookie)).body.items.find((r: any) => r.staleReason === 'regenerated');
    expect((await call(t, 'POST', api(`/recommendations/${superseded.id}/decide`), { decision: 'accept' }, dc.cookie)).status).toBe(409);
    expect(listAuditByActions(t.ctx, f.team.id, ['recommendation.decided']).length).toBe(recs.length);
  });

  it('draft editing: editors of the unit only; concurrent PATCH gets 409 with the server copy; submit, approve by the coordinator', async () => {
    const v = (await call(t, 'GET', api(`/plan-versions/${planVersionId}`), undefined, dc.cookie)).body.version;
    const edited = structuredClone(v.sections);
    edited.find((s: any) => s.key === 'fronts').items.push({ id: crypto.randomUUID(), text: 'Over to the field; Under into the boundary.', sourceRecommendationId: null, conceptIds: [conceptIds[0]], packageIds: [], order: 0 });
    // Offense position coach is not assigned to the defense; viewer never edits; other team 404.
    expect((await call(t, 'PATCH', api(`/plan-versions/${planVersionId}`), { sections: edited, expectedVersion: v.version }, f.pc.cookie)).status).toBe(403);
    expect((await call(t, 'PATCH', api(`/plan-versions/${planVersionId}`), { sections: edited, expectedVersion: v.version }, f.vw.cookie)).status).toBe(403);
    expect((await call(t, 'PATCH', api(`/plan-versions/${planVersionId}`), { sections: edited, expectedVersion: v.version }, other.hc.cookie)).status).toBe(404);
    const badKey = await call(t, 'PATCH', api(`/plan-versions/${planVersionId}`), { sections: [{ key: 'runs', title: 'Runs', items: [] }], expectedVersion: v.version }, dc.cookie);
    expect(badKey.status).toBe(400);
    const ok = await call(t, 'PATCH', api(`/plan-versions/${planVersionId}`), { sections: edited, expectedVersion: v.version }, dc.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.version.version).toBe(v.version + 1);
    // A second editor still holding the old version collides and receives the server copy.
    const other2 = structuredClone(v.sections);
    other2.find((s: any) => s.key === 'coverages').items.push({ id: crypto.randomUUID(), text: 'Cover 3 base', sourceRecommendationId: null, conceptIds: [], packageIds: [], order: 0 });
    const clash = await call(t, 'PATCH', api(`/plan-versions/${planVersionId}`), { sections: other2, expectedVersion: v.version }, f.hc.cookie);
    expect(clash.status).toBe(409);
    expect(clash.body.error.details.currentVersion).toBe(v.version + 1);
    expect(clash.body.error.details.current.sections.find((s: any) => s.key === 'fronts').items.some((i: any) => i.text.startsWith('Over to the field'))).toBe(true);
    // Comments: any member, anchored to a section or an item.
    const comment = await call(t, 'POST', api(`/plan-versions/${planVersionId}/comments`), { sectionKey: 'two_minute', itemId: acceptedItemId, body: 'Who sets the edge to trips?' }, f.vw.cookie);
    expect(comment.status).toBe(400); // the item is not in the two-minute section
    const comment2 = await call(t, 'POST', api(`/plan-versions/${planVersionId}/comments`), { itemId: acceptedItemId, body: 'Who sets the edge to trips?' }, f.vw.cookie);
    expect(comment2.status).toBe(201);
    const resolved = await call(t, 'POST', api(`/plan-comments/${comment2.body.comment.id}/resolve`), undefined, dc.cookie);
    expect(resolved.body.comment.resolvedAt).toBeTruthy();
    expect((await call(t, 'GET', api(`/plan-versions/${planVersionId}/comments`), undefined, f.an.cookie)).body.items).toHaveLength(1);
    // Submit and approve: offense coordinator cannot approve the defense; position coach cannot; the DC can (no override).
    const submit = await call(t, 'POST', api(`/plan-versions/${planVersionId}/submit`), {}, dc.cookie);
    expect(submit.status).toBe(200);
    expect(submit.body.version.status).toBe('in_review');
    expect((await call(t, 'PATCH', api(`/plan-versions/${planVersionId}`), { sections: edited, expectedVersion: submit.body.version.version }, dc.cookie)).body.error.details.reason).toBe('not_draft');
    expect((await call(t, 'POST', api(`/plan-versions/${planVersionId}/approve`), {}, f.oc.cookie)).status).toBe(403);
    expect((await call(t, 'POST', api(`/plan-versions/${planVersionId}/approve`), {}, f.pc.cookie)).status).toBe(403);
    const approve = await call(t, 'POST', api(`/plan-versions/${planVersionId}/approve`), { note: 'ready for Friday' }, dc.cookie);
    expect(approve.status).toBe(200);
    expect(approve.body.version).toMatchObject({ status: 'approved', override: false, approvedBy: dc.user.id });
    approvedId = planVersionId;
    expect(listAuditByActions(t.ctx, f.team.id, ['plan.approved']).length).toBe(1);
    expect(listAuditByActions(t.ctx, f.team.id, ['plan.submitted']).length).toBe(1);
  });

  it('review flags appear when film labels change after approval; a new draft comes from the approved version; reopen; head-coach override is flagged', async () => {
    const clean = await call(t, 'GET', api(`/games/${gameId}/plans/defense`), undefined, f.vw.cookie);
    expect(clean.body.reviewFlags).toEqual([]);
    const labelId = film.labelIds[0]!.play_type!;
    const label = (await call(t, 'GET', api(`/segments/${film.segmentIds[0]}/labels`), undefined, f.an.cookie)).body.items.find((l: any) => l.id === labelId);
    expect((await call(t, 'PATCH', api(`/labels/${labelId}`), { accepted: { value: 'pass', status: 'corrected' }, expectedVersion: label.version }, f.an.cookie)).status).toBe(200);
    const flagged = await call(t, 'GET', api(`/games/${gameId}/plans/defense`), undefined, f.vw.cookie);
    const kinds = flagged.body.reviewFlags.map((x: any) => x.kind);
    expect(kinds).toContain('labels_changed');
    expect(kinds).toContain('stale_recommendation');
    expect(flagged.body.reviewFlags.filter((x: any) => x.kind === 'stale_recommendation').map((x: any) => x.itemId)).toContain(acceptedItemId);
    expect(flagged.body.reviewFlags.every((x: any) => x.versionId === approvedId)).toBe(true);
    // The approved snapshot is immutable; a new draft starts from it.
    expect((await call(t, 'PATCH', api(`/plan-versions/${approvedId}`), { sections: flagged.body.current.sections, expectedVersion: flagged.body.current.version }, dc.cookie)).status).toBe(409);
    expect((await call(t, 'POST', api(`/plan-versions/${approvedId}/draft`), undefined, f.pc.cookie)).status).toBe(403);
    const draft = await call(t, 'POST', api(`/plan-versions/${approvedId}/draft`), undefined, dc.cookie);
    expect(draft.status).toBe(201);
    expect(draft.body.version).toMatchObject({ status: 'draft', number: 2, basedOn: approvedId });
    expect(draft.body.version.sections).toEqual(flagged.body.current.sections);
    const twice = await call(t, 'POST', api(`/plan-versions/${approvedId}/draft`), undefined, dc.cookie);
    expect(twice.status).toBe(409);
    expect(twice.body.error.details.reason).toBe('draft_exists');
    const bundle = await call(t, 'GET', api(`/games/${gameId}/plans/defense`), undefined, f.vw.cookie);
    expect(bundle.body.current.id).toBe(draft.body.version.id);
    expect(bundle.body.versions.map((v: any) => v.status)).toEqual(['approved', 'draft']);
    // Accepting another recommendation now lands in the open draft.
    const deferred = (await call(t, 'GET', api(`/games/${gameId}/recommendations?unit=defense`), undefined, dc.cookie)).body.items.find((r: any) => r.storedStatus === 'deferred');
    if (deferred) {
      const acc = await call(t, 'POST', api(`/recommendations/${deferred.id}/decide`), { decision: 'accept' }, f.hc.cookie);
      expect(acc.status).toBe(200);
      expect(acc.body.planVersionId).toBe(draft.body.version.id);
    }
    // Submit, reopen (DC), submit again, head coach approves with override; the first approval is superseded.
    expect((await call(t, 'POST', api(`/plan-versions/${draft.body.version.id}/submit`), {}, dc.cookie)).body.version.status).toBe('in_review');
    expect((await call(t, 'POST', api(`/plan-versions/${draft.body.version.id}/reopen`), {}, f.pc.cookie)).status).toBe(403);
    const reopened = await call(t, 'POST', api(`/plan-versions/${draft.body.version.id}/reopen`), { note: 'add the goal-line package' }, dc.cookie);
    expect(reopened.body.version.status).toBe('draft');
    expect((await call(t, 'POST', api(`/plan-versions/${draft.body.version.id}/submit`), {}, f.hc.cookie)).status).toBe(200);
    const override = await call(t, 'POST', api(`/plan-versions/${draft.body.version.id}/approve`), {}, f.hc.cookie);
    expect(override.status).toBe(200);
    expect(override.body.version).toMatchObject({ status: 'approved', override: true, approvedBy: f.hc.user.id });
    const after = await call(t, 'GET', api(`/games/${gameId}/plans/defense`), undefined, f.vw.cookie);
    expect(after.body.versions.map((v: any) => [v.number, v.status])).toEqual([[1, 'superseded'], [2, 'approved']]);
    expect(after.body.current.id).toBe(draft.body.version.id);
    expect(listAuditByActions(t.ctx, f.team.id, ['plan.override_approved']).length).toBe(1);
    expect(listAuditByActions(t.ctx, f.team.id, ['plan.reopened']).length).toBe(1);
    expect(listAuditByActions(t.ctx, f.team.id, ['plan.draft_created']).length).toBe(1);
    approvedId = draft.body.version.id;
  });

  it('share links: approved versions only, 72 h cap, token shown once, public read, 410 after expiry and revoke, exports', async () => {
    const draft = await call(t, 'POST', api(`/plan-versions/${approvedId}/draft`), undefined, dc.cookie);
    expect(draft.status).toBe(201);
    expect((await call(t, 'POST', api(`/plan-versions/${draft.body.version.id}/share`), {}, dc.cookie)).status).toBe(409);
    expect((await call(t, 'POST', api(`/plan-versions/${approvedId}/share`), { expiresInHours: 100 }, dc.cookie)).status).toBe(400);
    expect((await call(t, 'POST', api(`/plan-versions/${approvedId}/share`), {}, other.hc.cookie)).status).toBe(404);
    const share = await call(t, 'POST', api(`/plan-versions/${approvedId}/share`), { expiresInHours: 48 }, f.vw.cookie);
    expect([share.status, share.body]).toEqual([201, expect.anything()]);
    expect(share.body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(share.body.url).toBe(`http://localhost:5173/shared/${share.body.token}`);
    expect(share.body.link.tokenHash).not.toContain(share.body.token);
    expect(new Date(share.body.link.expiresAt).getTime() - t.clock.now.getTime()).toBe(48 * 3_600_000);
    const listed = await call(t, 'GET', api(`/plan-versions/${approvedId}/share-links`), undefined, f.an.cookie);
    expect(listed.body.items).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(share.body.token);

    const pub = await t.app.request(api(`/shared/${share.body.token}`));
    expect(pub.status).toBe(200);
    const pubBody = await pub.json() as any;
    expect(pubBody.version.id).toBe(approvedId);
    expect(pubBody.version.status).toBe('approved');
    expect(pubBody.team.name).toBe('Plans (demo)');
    expect(pubBody.game.opponentName).toBe('Riverbend Otters (demo)');
    expect(pubBody.unit).toBe('defense');
    expect((await t.app.request(api(`/shared/${'A'.repeat(43)}`))).status).toBe(404);

    // Exports: session or share token; the draft is never reachable through the token.
    const html = await t.app.request(api(`/plan-versions/${approvedId}/export.html?token=${share.body.token}`));
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    const htmlText = await html.text();
    expect(htmlText).toContain('Plans (demo)');
    expect(htmlText).toContain('Defense game plan');
    expect(htmlText).toContain('Generated by FootballOS');
    expect(htmlText).not.toContain('<script');
    expect((await t.app.request(api(`/plan-versions/${draft.body.version.id}/export.html?token=${share.body.token}`))).status).toBe(404);
    expect((await t.app.request(api(`/plan-versions/${approvedId}/export.html`))).status).toBe(401);
    const sessionHtml = await t.app.request(api(`/plan-versions/${draft.body.version.id}/export.html`), { headers: { cookie: f.vw.cookie } });
    expect(sessionHtml.status).toBe(200);
    expect((await t.app.request(api(`/plan-versions/${approvedId}/export.html`), { headers: { cookie: other.hc.cookie } })).status).toBe(404);
    const pdf = await t.app.request(api(`/plan-versions/${approvedId}/export.pdf?token=${share.body.token}`));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(parsed.getTitle()).toContain('Defense game plan');

    // A default link lasts exactly 72 h (the cap).
    const share2 = await call(t, 'POST', api(`/plan-versions/${approvedId}/share`), {}, f.an.cookie);
    expect(share2.status).toBe(201);
    expect(new Date(share2.body.link.expiresAt).getTime() - t.clock.now.getTime()).toBe(72 * 3_600_000);
    // Expiry: the 48 h link is gone after 49 h, the 72 h link still works. (Sessions idle out at 12 h, so staff sign in again.)
    t.clock.advanceMs(49 * 3_600_000);
    const expired = await t.app.request(api(`/shared/${share.body.token}`));
    expect(expired.status).toBe(410);
    expect(((await expired.json()) as any).error).toMatchObject({ code: 'gone', details: { reason: 'expired' } });
    expect((await t.app.request(api(`/plan-versions/${approvedId}/export.pdf?token=${share.body.token}`))).status).toBe(410);
    expect((await t.app.request(api(`/shared/${share2.body.token}`))).status).toBe(200);
    for (const who of [f.hc, f.oc, f.pc, f.an, f.vw, other.hc]) who.cookie = await signIn(t, who.user.email, who.totpSecret);
    // Revoke: not the creator and not head coach → 403; creator → 204; then 410 revoked; head coach lists all links.
    expect((await call(t, 'DELETE', api(`/share-links/${share2.body.link.id}`), undefined, f.pc.cookie)).status).toBe(403);
    expect((await call(t, 'DELETE', api(`/share-links/${share2.body.link.id}`), undefined, other.hc.cookie)).status).toBe(404);
    expect((await call(t, 'DELETE', api(`/share-links/${share2.body.link.id}`), undefined, f.an.cookie)).status).toBe(204);
    const revoked = await t.app.request(api(`/shared/${share2.body.token}`));
    expect(revoked.status).toBe(410);
    expect(((await revoked.json()) as any).error.details.reason).toBe('revoked');
    expect((await call(t, 'GET', api(`/teams/${f.team.id}/share-links`), undefined, f.oc.cookie)).status).toBe(403);
    const all = await call(t, 'GET', api(`/teams/${f.team.id}/share-links`), undefined, f.hc.cookie);
    expect(all.body.items).toHaveLength(2);
    expect(listAuditByActions(t.ctx, f.team.id, ['plan.shared']).length).toBe(2);
    expect(listAuditByActions(t.ctx, f.team.id, ['plan.share_revoked']).length).toBe(1);
  });

  it('every new route answers 404 across teams', async () => {
    const o = other.hc.cookie;
    const checks: [string, string, unknown?][] = [
      ['GET', api(`/games/${gameId}/plans/defense`)],
      ['GET', api(`/plan-versions/${approvedId}`)],
      ['POST', api(`/plan-versions/${approvedId}/submit`), {}],
      ['POST', api(`/plan-versions/${approvedId}/approve`), {}],
      ['POST', api(`/plan-versions/${approvedId}/reopen`), {}],
      ['POST', api(`/plan-versions/${approvedId}/draft`)],
      ['GET', api(`/plan-versions/${approvedId}/comments`)],
      ['POST', api(`/plan-versions/${approvedId}/comments`), { body: 'x' }],
      ['GET', api(`/plan-versions/${approvedId}/share-links`)],
      ['GET', api(`/games/${gameId}/recommendations`)],
      ['GET', api(`/recommendations/${recs[0].id}`)],
      ['GET', api(`/teams/${f.team.id}/playbook/versions`)],
      ['GET', `${season()}/players`],
      ['GET', `${season()}/packages`],
      ['GET', `${season()}/depth-chart?unit=defense`],
      ['POST', `${season()}/roster-imports`, { filename: 'r.csv', content: 'a,b\n1,2' }],
    ];
    for (const [method, path, body] of checks) {
      const r = await call(t, method, path, body, o);
      expect(`${method} ${path} ${r.status} ${JSON.stringify(r.body)}`).toBe(`${method} ${path} 404 ${JSON.stringify(r.body)}`);
    }
  });
});
