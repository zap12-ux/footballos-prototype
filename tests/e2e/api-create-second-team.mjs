#!/usr/bin/env node
// QA fixture helper: creates a SECOND fictional demo team (with one season and one game) in an
// existing FootballOS data directory so cross-team scoping can be probed from the first team.
// Uses the API's built service layer (apps/api/dist); run `npm run build -w apps/api` first.
// No users are created and nothing is printed except the ids.
//
//   FOOTBALLOS_DATA_DIR=<abs path> FOOTBALLOS_ENV=demo node tests/e2e/api-create-second-team.mjs
//
// Optional (B6): when FOS_T2_EMAIL and FOS_T2_PASSWORD are set, a position coach with that e-mail
// and password is created in the second team (credentials come only from the environment and are
// never printed), so cross-team checks can run as a genuine member of another team.
//
// Prints JSON: { teamId, seasonId, gameId, userId? }. Refuses to run when FOOTBALLOS_ENV=production.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', '..', 'apps', 'api', 'dist');
if ((process.env.FOOTBALLOS_ENV || '') === 'production' || (process.env.NODE_ENV || '') === 'production') {
  console.error('refusing to create fixture data in a production environment');
  process.exit(2);
}
if (!process.env.FOOTBALLOS_DATA_DIR) {
  console.error('FOOTBALLOS_DATA_DIR is required');
  process.exit(2);
}

const { buildContext } = await import(path.join(dist, 'bootstrap-context.js'));
const { createTeam, addMembership } = await import(path.join(dist, 'services', 'teams.js'));
const { createSeason, createGame, createOpponent } = await import(path.join(dist, 'services', 'schedule.js'));
const { createUser } = await import(path.join(dist, 'services', 'users.js'));

process.env.WORKER_CONCURRENCY = '0';
process.env.WORKER_INLINE = 'false';
const { ctx, close } = buildContext({});
try {
  const team = createTeam(ctx, {
    name: 'QA Second Team (demo)',
    shortName: 'QA2',
    level: 'high_school',
    environmentKind: 'demo',
    timezone: 'America/New_York',
  });
  const season = createSeason(ctx, team.id, { label: '2026', startsOn: '2026-08-01', endsOn: '2026-12-15', isCurrent: true });
  const opp = createOpponent(ctx, team.id, { name: 'QA Fictional Opponent (demo)', shortName: 'QFO', notes: '' });
  const game = createGame(ctx, team.id, season.id, {
    week: 1,
    kind: 'regular',
    opponentId: opp.id,
    location: 'home',
    scheduledAt: '2026-09-04T23:00:00.000Z',
    notes: 'QA fixture game',
  });
  let userId;
  if (process.env.FOS_T2_EMAIL && process.env.FOS_T2_PASSWORD) {
    const user = await createUser(ctx, { email: process.env.FOS_T2_EMAIL, displayName: 'QA Second-Team Coach (demo)', password: process.env.FOS_T2_PASSWORD });
    addMembership(ctx, { teamId: team.id, userId: user.id, role: 'position_coach', units: ['offense'], title: 'QA fixture' });
    userId = user.id;
  }
  process.stdout.write(JSON.stringify({ teamId: team.id, seasonId: season.id, gameId: game.id, ...(userId ? { userId } : {}) }) + '\n');
} finally {
  close();
}
