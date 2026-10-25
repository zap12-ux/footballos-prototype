import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeTestApp, seedTeamWithStaff, type TestApp } from './helpers.js';

let t: TestApp;
let alpha: Awaited<ReturnType<typeof seedTeamWithStaff>>;
let beta: Awaited<ReturnType<typeof seedTeamWithStaff>>;
beforeAll(async () => {
  t = makeTestApp();
  alpha = await seedTeamWithStaff(t, 'Alpha (demo)');
  beta = await seedTeamWithStaff(t, 'Beta (demo)');
});
afterAll(() => t.close());

describe('team scoping', () => {
  it('lists only the teams the user belongs to', async () => {
    const res = await call(t, 'GET', '/api/v1/teams', undefined, alpha.hc.cookie);
    expect(res.status).toBe(200);
    expect(res.body.items.map((x: any) => x.id)).toEqual([alpha.team.id]);
    expect(res.body.items[0].membership.role).toBe('head_coach');
    expect(res.body.items[0].environmentKind).toBe('demo');
  });

  it('cross-team reads return 404, not 403, for every team-keyed route', async () => {
    const paths = [
      `/api/v1/teams/${beta.team.id}`,
      `/api/v1/teams/${beta.team.id}/staff`,
      `/api/v1/teams/${beta.team.id}/seasons`,
      `/api/v1/teams/${beta.team.id}/seasons/${beta.season.id}/games`,
      `/api/v1/teams/${beta.team.id}/usage`,
      `/api/v1/teams/${beta.team.id}/audit`,
      `/api/v1/teams/${beta.team.id}/invites`,
    ];
    for (const p of paths) {
      const res = await call(t, 'GET', p, undefined, alpha.hc.cookie);
      expect(res.status, p).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
  });

  it('cross-team writes and record-keyed routes (games, imports) also return 404', async () => {
    const created = await call(t, 'POST', `/api/v1/teams/${beta.team.id}/opponents`, { name: 'Beta Opp' }, beta.hc.cookie);
    const game = await call(t, 'POST', `/api/v1/teams/${beta.team.id}/seasons/${beta.season.id}/games`, { week: 1, opponentId: created.body.id, location: 'home' }, beta.hc.cookie);
    expect(game.status).toBe(201);
    expect((await call(t, 'GET', `/api/v1/games/${game.body.id}`, undefined, alpha.hc.cookie)).status).toBe(404);
    expect((await call(t, 'PATCH', `/api/v1/games/${game.body.id}`, { expectedVersion: 1, notes: 'x' }, alpha.hc.cookie)).status).toBe(404);
    expect((await call(t, 'POST', `/api/v1/teams/${beta.team.id}/invites`, { email: 'x@y.test', role: 'viewer' }, alpha.hc.cookie)).status).toBe(404);
    expect((await call(t, 'POST', `/api/v1/teams/${beta.team.id}/seasons`, { label: '2027', startsOn: '2027-08-01', endsOn: '2027-12-01' }, alpha.hc.cookie)).status).toBe(404);
    // and the legitimate owner still sees it
    expect((await call(t, 'GET', `/api/v1/games/${game.body.id}`, undefined, beta.vw.cookie)).status).toBe(200);
  });

  it('unauthenticated requests get 401 with the error envelope', async () => {
    const res = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'unauthorized', message: 'Authentication required' } });
  });
});

describe('role denials (403)', () => {
  it('only the head coach manages invites, staff and the audit log', async () => {
    for (const who of [alpha.oc, alpha.pc, alpha.an, alpha.vw]) {
      expect((await call(t, 'POST', `/api/v1/teams/${alpha.team.id}/invites`, { email: 'z@alpha.test', role: 'viewer' }, who.cookie)).status).toBe(403);
      expect((await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/audit`, undefined, who.cookie)).status).toBe(403);
    }
    const staff = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/staff`, undefined, alpha.vw.cookie);
    expect(staff.status).toBe(200); // any member may view staff
    const viewerMembership = staff.body.items.find((m: any) => m.role === 'viewer');
    const denied = await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/staff/${viewerMembership.id}`, { title: 'Nope' }, alpha.oc.cookie);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('forbidden');
    const allowed = await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/staff/${viewerMembership.id}`, { title: 'Film Volunteer' }, alpha.hc.cookie);
    expect(allowed.status).toBe(200);
    expect(allowed.body.title).toBe('Film Volunteer');
    const audit = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/audit`, undefined, alpha.hc.cookie);
    expect(audit.body.items.some((e: any) => e.action === 'staff.role_changed' && e.targetId === viewerMembership.id)).toBe(true);
  });

  it('position coaches, analysts and viewers cannot create seasons, opponents or games; coordinators can', async () => {
    for (const who of [alpha.pc, alpha.an, alpha.vw]) {
      expect((await call(t, 'POST', `/api/v1/teams/${alpha.team.id}/seasons`, { label: '2027', startsOn: '2027-08-01', endsOn: '2027-12-01' }, who.cookie)).status).toBe(403);
      expect((await call(t, 'POST', `/api/v1/teams/${alpha.team.id}/opponents`, { name: 'Nope' }, who.cookie)).status).toBe(403);
    }
    expect((await call(t, 'POST', `/api/v1/teams/${alpha.team.id}/opponents`, { name: 'Coord Opp' }, alpha.oc.cookie)).status).toBe(201);
  });

  it('the last active head coach cannot be demoted or deactivated', async () => {
    const staff = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/staff`, undefined, alpha.hc.cookie);
    const hcMembership = staff.body.items.find((m: any) => m.role === 'head_coach');
    const demote = await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/staff/${hcMembership.id}`, { role: 'analyst' }, alpha.hc.cookie);
    expect(demote.status).toBe(409);
    const deactivate = await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/staff/${hcMembership.id}`, { active: false }, alpha.hc.cookie);
    expect(deactivate.status).toBe(409);
  });

  it('a deactivated member loses access on the next request', async () => {
    const staff = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/staff`, undefined, alpha.hc.cookie);
    const an = staff.body.items.find((m: any) => m.role === 'analyst');
    expect((await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/staff/${an.id}`, { active: false }, alpha.hc.cookie)).status).toBe(200);
    expect((await call(t, 'GET', `/api/v1/teams/${alpha.team.id}`, undefined, alpha.an.cookie)).status).toBe(404);
    expect((await call(t, 'PATCH', `/api/v1/teams/${alpha.team.id}/staff/${an.id}`, { active: true }, alpha.hc.cookie)).status).toBe(200);
    expect((await call(t, 'GET', `/api/v1/teams/${alpha.team.id}`, undefined, alpha.an.cookie)).status).toBe(200);
  });
});

describe('ops', () => {
  it('healthz is public and usage returns the zero shape', async () => {
    const h = await call(t, 'GET', '/healthz');
    expect(h.status).toBe(200);
    expect(h.body).toMatchObject({ ok: true, environment: 'development' });
    const u = await call(t, 'GET', `/api/v1/teams/${alpha.team.id}/usage`, undefined, alpha.vw.cookie);
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ teamId: alpha.team.id, costUsd: 0, inputTokens: 0, outputTokens: 0, byKind: [] });
    expect(u.body.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('unknown routes return the not_found envelope (401 first when under the authenticated prefix)', async () => {
    const pub = await call(t, 'GET', '/nothing-here');
    expect(pub.status).toBe(404);
    expect(pub.body.error.code).toBe('not_found');
    expect((await call(t, 'GET', '/api/v1/nothing-here')).status).toBe(401);
    const authed = await call(t, 'GET', '/api/v1/nothing-here', undefined, alpha.vw.cookie);
    expect(authed.status).toBe(404);
    expect(authed.body.error.code).toBe('not_found');
  });
});
