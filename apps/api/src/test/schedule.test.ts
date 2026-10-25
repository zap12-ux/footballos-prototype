import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeSeasonRecord } from '../services/schedule.js';
import { listAuditByActions } from '../services/teams.js';
import { call, makeTestApp, seedTeamWithStaff, type TestApp } from './helpers.js';

let t: TestApp;
let f: Awaited<ReturnType<typeof seedTeamWithStaff>>;
beforeAll(async () => {
  t = makeTestApp();
  f = await seedTeamWithStaff(t, 'Sched (demo)');
});
afterAll(() => t.close());

const api = (p: string) => `/api/v1${p}`;

describe('seasons and games', () => {
  let oppA: string;
  let oppB: string;
  let game1: any;

  it('creates opponents and games; a bye has no opponent', async () => {
    oppA = (await call(t, 'POST', api(`/teams/${f.team.id}/opponents`), { name: 'Riverbend Otters (demo)' }, f.hc.cookie)).body.id;
    oppB = (await call(t, 'POST', api(`/teams/${f.team.id}/opponents`), { name: 'Cedar Hollow Lynx (demo)', shortName: 'CHL' }, f.oc.cookie)).body.id;
    const g = await call(t, 'POST', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), { week: 1, opponentId: oppA, location: 'home', scheduledAt: '2026-08-28T23:00:00.000Z' }, f.hc.cookie);
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ week: 1, kind: 'regular', status: 'scheduled', result: null, version: 1, opponentId: oppA });
    game1 = g.body;
    const missingOpp = await call(t, 'POST', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), { week: 2 }, f.hc.cookie);
    expect(missingOpp.status).toBe(400);
    const bye = await call(t, 'POST', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), { week: 2, kind: 'bye' }, f.hc.cookie);
    expect(bye.status).toBe(201);
    const unknownOpp = await call(t, 'POST', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), { week: 3, opponentId: crypto.randomUUID() }, f.hc.cookie);
    expect(unknownOpp.status).toBe(404);
    await call(t, 'POST', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), { week: 3, opponentId: oppB, location: 'away' }, f.hc.cookie);
    const list = await call(t, 'GET', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), undefined, f.vw.cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.map((x: any) => x.week)).toEqual([1, 2, 3]);
    expect(list.body.record).toEqual({ wins: 0, losses: 0, ties: 0, played: 0 });
  });

  it('PATCH enforces expectedVersion (409 with currentVersion) and bumps the version', async () => {
    const stale = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 7, notes: 'x' }, f.hc.cookie);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'conflict', details: { currentVersion: 1 } });
    const ok = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 1, notes: 'Senior night' }, f.hc.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(2);
    const replay = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 1, notes: 'again' }, f.hc.cookie);
    expect(replay.status).toBe(409);
    expect(replay.body.error.details.currentVersion).toBe(2);
    expect((await call(t, 'PATCH', api(`/games/${game1.id}`), { notes: 'no version' }, f.hc.cookie)).status).toBe(400);
  });

  it('status transitions: final needs a result, a result needs final, canceled can be reinstated, final is terminal', async () => {
    const noResult = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 2, status: 'final' }, f.hc.cookie);
    expect(noResult.status).toBe(409);
    const resultEarly = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 2, result: { ourScore: 21, theirScore: 14, outcome: 'win' } }, f.hc.cookie);
    expect(resultEarly.status).toBe(409);
    const badOutcome = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 2, status: 'final', result: { ourScore: 7, theirScore: 14, outcome: 'win' } }, f.hc.cookie);
    expect(badOutcome.status).toBe(400);
    const postponed = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 2, status: 'postponed' }, f.oc.cookie);
    expect(postponed.status).toBe(200);
    const back = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 3, status: 'scheduled' }, f.hc.cookie);
    expect(back.status).toBe(409); // postponed → scheduled is not allowed; rescheduled is
    const resched = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 3, status: 'rescheduled', scheduledAt: '2026-08-29T23:00:00.000Z' }, f.hc.cookie);
    expect(resched.status).toBe(200);
    const final = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 4, status: 'final', result: { ourScore: 21, theirScore: 14, outcome: 'win' } }, f.hc.cookie);
    expect(final.status).toBe(200);
    expect(final.body.result.outcome).toBe('win');
    const reopen = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 5, status: 'scheduled' }, f.hc.cookie);
    expect(reopen.status).toBe(409);
    const correct = await call(t, 'PATCH', api(`/games/${game1.id}`), { expectedVersion: 5, result: { ourScore: 24, theirScore: 14, outcome: 'win' } }, f.hc.cookie);
    expect(correct.status).toBe(200);
    expect(correct.body.result.ourScore).toBe(24);
  });

  it('season record counts only final games with results; byes and canceled games are excluded', async () => {
    const list = await call(t, 'GET', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), undefined, f.hc.cookie);
    const week3 = list.body.items.find((g: any) => g.week === 3);
    expect((await call(t, 'PATCH', api(`/games/${week3.id}`), { expectedVersion: 1, status: 'final', result: { ourScore: 10, theirScore: 17, outcome: 'loss' } }, f.hc.cookie)).status).toBe(200);
    const g4 = await call(t, 'POST', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), { week: 4, opponentId: oppA, location: 'away' }, f.hc.cookie);
    expect((await call(t, 'PATCH', api(`/games/${g4.body.id}`), { expectedVersion: 1, status: 'canceled' }, f.hc.cookie)).status).toBe(200);
    const g5 = await call(t, 'POST', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), { week: 5, opponentId: oppB, location: 'home' }, f.hc.cookie);
    expect((await call(t, 'PATCH', api(`/games/${g5.body.id}`), { expectedVersion: 1, status: 'final', result: { ourScore: 14, theirScore: 14, outcome: 'tie' } }, f.hc.cookie)).status).toBe(200);
    const after = await call(t, 'GET', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), undefined, f.vw.cookie);
    expect(after.body.record).toEqual({ wins: 1, losses: 1, ties: 1, played: 3 });
    const seasons = await call(t, 'GET', api(`/teams/${f.team.id}/seasons`), undefined, f.vw.cookie);
    expect(seasons.body.items[0].record).toEqual({ wins: 1, losses: 1, ties: 1, played: 3 });
  });

  it('computeSeasonRecord unit cases', () => {
    expect(computeSeasonRecord([])).toEqual({ wins: 0, losses: 0, ties: 0, played: 0 });
    expect(computeSeasonRecord([
      { status: 'final', kind: 'regular', result: { ourScore: 1, theirScore: 0, outcome: 'win' } },
      { status: 'final', kind: 'playoff', result: { ourScore: 0, theirScore: 1, outcome: 'loss' } },
      { status: 'final', kind: 'bye', result: null },
      { status: 'canceled', kind: 'regular', result: null },
      { status: 'scheduled', kind: 'regular', result: null },
    ])).toEqual({ wins: 1, losses: 1, ties: 0, played: 2 });
  });

  it('creating a new current season clears the previous current flag', async () => {
    const s2 = await call(t, 'POST', api(`/teams/${f.team.id}/seasons`), { label: '2027', startsOn: '2027-08-01', endsOn: '2027-12-01', isCurrent: true }, f.hc.cookie);
    expect(s2.status).toBe(201);
    const seasons = await call(t, 'GET', api(`/teams/${f.team.id}/seasons`), undefined, f.hc.cookie);
    expect(seasons.body.items.filter((s: any) => s.isCurrent).map((s: any) => s.label)).toEqual(['2027']);
    expect((await call(t, 'POST', api(`/teams/${f.team.id}/seasons`), { label: 'bad', startsOn: '2027-12-01', endsOn: '2027-08-01' }, f.hc.cookie)).status).toBe(400);
  });
});

describe('schedule import', () => {
  const csv = [
    'Week,Date,Time,Opponent,Location,Notes',
    '1,8/28/2026,7:00 PM,Riverbend Otters (demo),Home,Opener',
    '2,09/04/2026,19:00,Port Averly Mariners (demo),Away,',
    '3,2026-09-11,,BYE,,',
    'four,not a date,7 PM,Stonebridge Rams (demo),Mars,bad row',
    '5,2026-09-25,7:00 PM,"Elmgrove ""Hawks"" Falcons (demo)",Neutral,quoted',
  ].join('\r\n');

  let importId: string;

  it('preview maps headers, parses rows in the team time zone and reports the bad row without writing games', async () => {
    const res = await call(t, 'POST', api(`/teams/${f.team.id}/schedule-imports`), { seasonId: f.season.id, filename: 'schedule.csv', content: csv }, f.oc.cookie);
    expect(res.status).toBe(201);
    importId = res.body.id;
    expect(res.body.status).toBe('previewed');
    expect(res.body.mapping).toEqual({ Week: 'week', Date: 'date', Time: 'time', Opponent: 'opponent', Location: 'location', Notes: 'notes' });
    expect(res.body.rowCount).toBe(5);
    expect(res.body.rows).toHaveLength(4);
    expect(res.body.rows[0]).toMatchObject({ row: 1, week: 1, kind: 'regular', opponentName: 'Riverbend Otters (demo)', location: 'home', scheduledAt: '2026-08-28T23:00:00.000Z', notes: 'Opener' });
    expect(res.body.rows[1].scheduledAt).toBe('2026-09-04T23:00:00.000Z');
    expect(res.body.rows[2]).toMatchObject({ week: 3, kind: 'bye', opponentName: null });
    expect(res.body.rows[3].opponentName).toBe('Elmgrove "Hawks" Falcons (demo)');
    const bad = res.body.errors;
    expect(bad.every((e: any) => e.row === 4)).toBe(true);
    expect(bad.map((e: any) => e.column).sort()).toEqual(['Date', 'Location', 'Week']);
    const games = await call(t, 'GET', api(`/teams/${f.team.id}/seasons/${f.season.id}/games`), undefined, f.hc.cookie);
    expect(games.body.items.every((g: any) => g.notes !== 'Opener')).toBe(true);
  });

  it('apply refuses while errors exist, then applies the valid rows with skipInvalidRows and writes an audit row', async () => {
    const refused = await call(t, 'POST', api(`/schedule-imports/${importId}/apply`), {}, f.oc.cookie);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.errorCount).toBe(3);
    expect((await call(t, 'POST', api(`/schedule-imports/${importId}/apply`), { skipInvalidRows: true }, f.pc.cookie)).status).toBe(403);
    const before = (await call(t, 'GET', api(`/teams/${f.team.id}/opponents`), undefined, f.hc.cookie)).body.items.length;
    const applied = await call(t, 'POST', api(`/schedule-imports/${importId}/apply`), { skipInvalidRows: true }, f.oc.cookie);
    expect(applied.status).toBe(200);
    expect(applied.body.import.status).toBe('applied');
    expect(applied.body.createdGameIds).toHaveLength(4);
    expect(applied.body.skippedRows).toEqual([4]);
    // Riverbend already existed (case-insensitive match); two new opponents were created
    expect(applied.body.createdOpponentIds).toHaveLength(2);
    const after = (await call(t, 'GET', api(`/teams/${f.team.id}/opponents`), undefined, f.hc.cookie)).body.items.length;
    expect(after - before).toBe(2);
    expect(listAuditByActions(t.ctx, f.team.id, ['schedule_import.applied']).map((a) => a.targetId)).toContain(importId);
    expect((await call(t, 'POST', api(`/schedule-imports/${importId}/apply`), { skipInvalidRows: true }, f.oc.cookie)).status).toBe(409);
    const fetched = await call(t, 'GET', api(`/schedule-imports/${importId}`), undefined, f.vw.cookie);
    expect(fetched.body.status).toBe('applied');
  });

  it('rejects .xlsx by name and empty/headerless files are reported', async () => {
    const xlsx = await call(t, 'POST', api(`/teams/${f.team.id}/schedule-imports`), { seasonId: f.season.id, filename: 'schedule.xlsx', content: 'x' }, f.hc.cookie);
    expect(xlsx.status).toBe(400);
    const nohead = await call(t, 'POST', api(`/teams/${f.team.id}/schedule-imports`), { seasonId: f.season.id, filename: 'odd.csv', content: 'a,b\n1,2\n' }, f.hc.cookie);
    expect(nohead.status).toBe(201);
    expect(nohead.body.rows).toHaveLength(0);
    expect(nohead.body.errors[0].message).toMatch(/opponent column/);
    const discard = await call(t, 'POST', api(`/schedule-imports/${nohead.body.id}/discard`), undefined, f.hc.cookie);
    expect(discard.body.status).toBe('discarded');
  });
});
