import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditByActions } from '../services/teams.js';
import { call, makeTestApp, seedTeamWithStaff, type TestApp } from './helpers.js';

let t: TestApp;
let f: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let other: Awaited<ReturnType<typeof seedTeamWithStaff>>;
beforeAll(async () => {
  t = makeTestApp();
  f = await seedTeamWithStaff(t, 'Roster (demo)');
  other = await seedTeamWithStaff(t, 'Others (demo)');
});
afterAll(() => t.close());

const api = (p: string) => `/api/v1${p}`;
const base = () => api(`/teams/${f.team.id}/seasons/${f.season.id}`);

const CSV = [
  'Number,First Name,Last Name,Position,Class,Status',
  '7,Demo,Quarterback,QB,JR,active',
  '21,Sample,Back,RB/KR,SO,',
  '55,Example,Lineman,OL,SR,injured',
  'x9,Bad,Row,DL,FR,active',
  '21,Dup,Jersey,WR,FR,active',
].join('\n');

describe('§15.2 personnel', () => {
  let qbId: string;
  let rbId: string;
  let pkgId: string;

  it('creates and patches players; viewers and position coaches cannot edit; cross-team is 404', async () => {
    const created = await call(t, 'POST', `${base()}/players`, { jersey: '12', firstName: 'Starter', lastName: 'Passer', positions: ['QB'], classYear: 'SR' }, f.oc.cookie);
    expect(created.status).toBe(201);
    expect(created.body.player).toMatchObject({ jersey: '12', status: 'active', availability: [], version: 1 });
    qbId = created.body.player.id;
    expect((await call(t, 'POST', `${base()}/players`, { firstName: 'No', lastName: 'Rights' }, f.pc.cookie)).status).toBe(403);
    expect((await call(t, 'POST', `${base()}/players`, { firstName: 'No', lastName: 'Rights' }, f.vw.cookie)).status).toBe(403);
    expect((await call(t, 'GET', `${base()}/players`, undefined, other.hc.cookie)).status).toBe(404);
    expect((await call(t, 'GET', api(`/players/${qbId}`), undefined, other.hc.cookie)).status).toBe(404);
    const stale = await call(t, 'PATCH', api(`/players/${qbId}`), { expectedVersion: 5, notes: 'x' }, f.hc.cookie);
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentVersion).toBe(1);
    const ok = await call(t, 'PATCH', api(`/players/${qbId}`), { expectedVersion: 1, availability: [{ week: 1, status: 'out', note: 'ankle' }, { week: 2, status: 'limited', note: '' }], strengths: ['arm'] }, f.hc.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.player.version).toBe(2);
    expect(ok.body.player.availability).toEqual([{ week: 1, status: 'out', note: 'ankle' }, { week: 2, status: 'limited', note: '' }]);
    expect(listAuditByActions(t.ctx, f.team.id, ['roster.edited']).length).toBe(2);
  });

  it('roster import: preview reports a bad row, apply refuses without skipInvalidRows, then creates and updates players', async () => {
    const preview = await call(t, 'POST', `${base()}/roster-imports`, { filename: 'roster.csv', content: CSV }, f.oc.cookie);
    expect(preview.status).toBe(201);
    expect(preview.body.mapping).toMatchObject({ Number: 'jersey', 'First Name': 'first', 'Last Name': 'last', Position: 'positions', Class: 'class', Status: 'status' });
    expect(preview.body.rowCount).toBe(5);
    expect(preview.body.rows).toHaveLength(3);
    expect(preview.body.rows[1]).toMatchObject({ jersey: '21', firstName: 'Sample', lastName: 'Back', positions: ['RB', 'KR'], classYear: 'SO', status: 'active', matchesPlayerId: null });
    expect(preview.body.errors.map((e: any) => e.row)).toEqual([4, 5]);
    expect(preview.body.errors[0].message).toMatch(/jersey/);
    const refused = await call(t, 'POST', api(`/roster-imports/${preview.body.id}/apply`), {}, f.oc.cookie);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.errorCount).toBe(2);
    expect((await call(t, 'POST', api(`/roster-imports/${preview.body.id}/apply`), { skipInvalidRows: true }, f.pc.cookie)).status).toBe(403);
    expect((await call(t, 'POST', api(`/roster-imports/${preview.body.id}/apply`), { skipInvalidRows: true }, other.hc.cookie)).status).toBe(404);
    const applied = await call(t, 'POST', api(`/roster-imports/${preview.body.id}/apply`), { skipInvalidRows: true }, f.oc.cookie);
    expect(applied.status).toBe(200);
    expect(applied.body.createdPlayerIds).toHaveLength(3);
    expect(applied.body.updatedPlayerIds).toHaveLength(0);
    expect(applied.body.skippedRows).toEqual([4, 5]);
    expect(applied.body.import.status).toBe('applied');
    expect((await call(t, 'POST', api(`/roster-imports/${preview.body.id}/apply`), { skipInvalidRows: true }, f.oc.cookie)).status).toBe(409);
    const list = await call(t, 'GET', `${base()}/players`, undefined, f.vw.cookie);
    expect(list.body.items.map((p: any) => p.jersey)).toEqual(['7', '12', '21', '55']);
    rbId = list.body.items.find((p: any) => p.jersey === '21').id;
    // Re-importing matches on jersey + last name and updates instead of duplicating.
    const again = await call(t, 'POST', `${base()}/roster-imports`, { filename: 'roster2.csv', content: 'Number,Name,Position\n21,"Back, Sample",RB\n' }, f.hc.cookie);
    expect(again.body.rows[0].matchesPlayerId).toBe(rbId);
    const applied2 = await call(t, 'POST', api(`/roster-imports/${again.body.id}/apply`), {}, f.hc.cookie);
    expect(applied2.body.updatedPlayerIds).toEqual([rbId]);
    expect(applied2.body.createdPlayerIds).toEqual([]);
    expect(listAuditByActions(t.ctx, f.team.id, ['roster_import.applied']).length).toBe(2);
  });

  it('depth chart: first PUT without expectedVersion, then 409 on a stale version with the current chart', async () => {
    expect((await call(t, 'GET', `${base()}/depth-chart?unit=offense`, undefined, f.vw.cookie)).body.depthChart).toBeNull();
    const first = await call(t, 'PUT', `${base()}/depth-chart?unit=offense`, { slots: [{ position: 'QB', order: 1, playerId: qbId }, { position: 'RB', order: 1, playerId: rbId }] }, f.oc.cookie);
    expect(first.status).toBe(200);
    expect(first.body.depthChart).toMatchObject({ unit: 'offense', version: 1 });
    const stale = await call(t, 'PUT', `${base()}/depth-chart?unit=offense`, { slots: [{ position: 'QB', order: 1, playerId: rbId }], expectedVersion: 7 }, f.oc.cookie);
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentVersion).toBe(1);
    expect(stale.body.error.details.current.slots).toHaveLength(2);
    expect((await call(t, 'PUT', `${base()}/depth-chart?unit=offense`, { slots: [], expectedVersion: 1 }, f.pc.cookie)).status).toBe(403);
    const unknownPlayer = await call(t, 'PUT', `${base()}/depth-chart?unit=offense`, { slots: [{ position: 'QB', order: 1, playerId: crypto.randomUUID() }], expectedVersion: 1 }, f.oc.cookie);
    expect(unknownPlayer.status).toBe(404);
    const ok = await call(t, 'PUT', `${base()}/depth-chart?unit=offense`, { slots: [{ position: 'QB', order: 1, playerId: qbId }, { position: 'QB', order: 2, playerId: rbId }], expectedVersion: 1 }, f.hc.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.depthChart.version).toBe(2);
    expect((await call(t, 'GET', `${base()}/depth-chart?unit=defense`, undefined, f.vw.cookie)).body.depthChart).toBeNull();
    expect(listAuditByActions(t.ctx, f.team.id, ['depth_chart.updated']).length).toBe(2);
  });

  it('packages: availability flags a package whose player is out for the selected week', async () => {
    const created = await call(t, 'POST', `${base()}/packages`, { unit: 'offense', name: '11', playerIds: [qbId, rbId], description: 'one back one tight end' }, f.oc.cookie);
    expect(created.status).toBe(201);
    pkgId = created.body.package.id;
    const two = await call(t, 'POST', `${base()}/packages`, { unit: 'offense', name: '21', playerIds: [rbId] }, f.oc.cookie);
    expect(two.status).toBe(201);
    expect((await call(t, 'POST', `${base()}/packages`, { unit: 'offense', name: 'x', playerIds: [crypto.randomUUID()] }, f.oc.cookie)).status).toBe(404);
    const week1 = await call(t, 'GET', `${base()}/packages?unit=offense&week=1`, undefined, f.vw.cookie);
    expect(week1.status).toBe(200);
    expect(week1.body.items).toHaveLength(2);
    const a11 = week1.body.availability.find((a: any) => a.packageId === pkgId);
    expect(a11.available).toBe(false);
    expect(a11.reason).toMatch(/#12 Passer is out for week 1 \(ankle\)/);
    expect(week1.body.availability.find((a: any) => a.packageId === two.body.package.id).available).toBe(true);
    const week2 = await call(t, 'GET', `${base()}/packages?unit=offense&week=2`, undefined, f.vw.cookie);
    expect(week2.body.availability.every((a: any) => a.available)).toBe(true);
    const stale = await call(t, 'PATCH', api(`/packages/${pkgId}`), { expectedVersion: 3, name: 'Eleven' }, f.oc.cookie);
    expect(stale.status).toBe(409);
    const ok = await call(t, 'PATCH', api(`/packages/${pkgId}`), { expectedVersion: 1, name: 'Eleven' }, f.oc.cookie);
    expect(ok.body.package).toMatchObject({ name: 'Eleven', version: 2 });
    expect((await call(t, 'PATCH', api(`/packages/${pkgId}`), { expectedVersion: 2, name: 'x' }, other.hc.cookie)).status).toBe(404);
    expect((await call(t, 'PATCH', api(`/packages/${pkgId}`), { expectedVersion: 2, name: 'x' }, f.pc.cookie)).status).toBe(403);
  });

  it('soft-deletes a player (head coach only): inactive, hidden by default, package becomes unavailable', async () => {
    expect((await call(t, 'DELETE', api(`/players/${rbId}`), undefined, f.oc.cookie)).status).toBe(403);
    const del = await call(t, 'DELETE', api(`/players/${rbId}`), undefined, f.hc.cookie);
    expect(del.status).toBe(200);
    expect(del.body.player.status).toBe('inactive');
    const list = await call(t, 'GET', `${base()}/players`, undefined, f.vw.cookie);
    expect(list.body.items.some((p: any) => p.id === rbId)).toBe(false);
    const all = await call(t, 'GET', `${base()}/players?status=all`, undefined, f.vw.cookie);
    expect(all.body.items.some((p: any) => p.id === rbId)).toBe(true);
    const week2 = await call(t, 'GET', `${base()}/packages?unit=offense&week=2`, undefined, f.vw.cookie);
    expect(week2.body.availability.find((a: any) => a.packageId === pkgId)).toMatchObject({ available: false });
    expect(listAuditByActions(t.ctx, f.team.id, ['player.deleted']).length).toBe(1);
  });
});
