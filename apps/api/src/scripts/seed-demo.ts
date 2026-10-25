// Seeds one fictional DEMO team ("Winchester Hawks") with staff, season, opponents and schedule.
// Refuses to run against a production environment. Passwords and TOTP secrets are generated here
// and printed ONCE; they are not stored anywhere in plain text.
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { loadConfig, loadEnvFile } from '../config.js';
import { buildContext } from '../bootstrap-context.js';
import { teams } from '../db/schema.js';
import { newTotpSecret } from '../auth/totp.js';
import { createUser, enrollMfaDirect, findUserByEmail } from '../services/users.js';
import { addMembership, createTeam } from '../services/teams.js';
import { createGame, createOpponent, createSeason } from '../services/schedule.js';
import { zonedToUtcIso } from '../services/time.js';
import type { Role, Unit } from '@footballos/contracts';

loadEnvFile();
const config = loadConfig();
if (config.environment === 'production') {
  console.error('seed:demo refuses to run when FOOTBALLOS_ENV=production');
  process.exit(2);
}
const { ctx, close } = buildContext({ config });

const DEMO_TEAM_NAME = 'Winchester Hawks (demo)';
const existing = ctx.db.select().from(teams).where(eq(teams.name, DEMO_TEAM_NAME)).get();
if (existing) {
  console.error(`Demo team already exists (${existing.id}). Delete the database under ${config.dataDir} to reseed.`);
  close();
  process.exit(3);
}

function demoPassword(): string {
  // 18 random characters from an unambiguous alphabet; printed once below.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(18), (b) => alphabet[b % alphabet.length]).join('');
}

const STAFF: { email: string; displayName: string; role: Role; units: Unit[]; title: string }[] = [
  { email: 'head.coach@demo.footballos.test', displayName: 'Demo Head Coach', role: 'head_coach', units: ['offense', 'defense', 'special_teams'], title: 'Head Coach' },
  { email: 'oc@demo.footballos.test', displayName: 'Demo Offensive Coordinator', role: 'coordinator', units: ['offense'], title: 'Offensive Coordinator' },
  { email: 'dc@demo.footballos.test', displayName: 'Demo Defensive Coordinator', role: 'coordinator', units: ['defense'], title: 'Defensive Coordinator' },
  { email: 'ol.coach@demo.footballos.test', displayName: 'Demo OL Coach', role: 'position_coach', units: ['offense'], title: 'Offensive Line' },
  { email: 'db.coach@demo.footballos.test', displayName: 'Demo DB Coach', role: 'position_coach', units: ['defense'], title: 'Defensive Backs' },
  { email: 'analyst@demo.footballos.test', displayName: 'Demo Analyst', role: 'analyst', units: ['offense', 'defense', 'special_teams'], title: 'Analyst' },
];

const OPPONENTS = [
  'Riverbend Otters', 'Cedar Hollow Lynx', 'Port Averly Mariners', 'Stonebridge Rams', 'Elmgrove Falcons', 'Harrow Valley Bison', 'Kestrel Ridge Knights', 'Millbrook Comets',
];

async function main() {
  const team = createTeam(ctx, { name: DEMO_TEAM_NAME, shortName: 'WIN', level: 'high_school', environmentKind: 'demo', timezone: 'America/New_York' });
  const season = createSeason(ctx, team.id, { label: '2026', startsOn: '2026-08-15', endsOn: '2026-12-05', isCurrent: true });
  const credentials: { email: string; role: string; password: string; totpSecret: string | null }[] = [];
  for (const s of STAFF) {
    if (findUserByEmail(ctx, s.email)) throw new Error(`user ${s.email} already exists`);
    const password = demoPassword();
    const user = await createUser(ctx, { email: s.email, displayName: s.displayName, password });
    addMembership(ctx, { teamId: team.id, userId: user.id, role: s.role, units: s.units, title: s.title });
    let totpSecret: string | null = null;
    if (s.role === 'head_coach' || s.role === 'coordinator') {
      totpSecret = newTotpSecret();
      enrollMfaDirect(ctx, user.id, totpSecret);
    }
    credentials.push({ email: s.email, role: s.role, password, totpSecret });
  }
  const opps = OPPONENTS.map((name) => createOpponent(ctx, team.id, { name: `${name} (demo)`, notes: 'Fictional demo opponent' }));
  // Eight games plus one bye, Fridays at 7:00 pm local time starting 2026-08-28.
  const first = { y: 2026, m: 8, d: 28 };
  let week = 1;
  const games: string[] = [];
  for (let i = 0; i < 9; i++) {
    const date = new Date(Date.UTC(first.y, first.m - 1, first.d + i * 7));
    const d = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    if (i === 4) {
      createGame(ctx, team.id, season.id, { week, kind: 'bye', opponentId: null, location: null, scheduledAt: null, notes: 'Open week' });
      week++;
      continue;
    }
    const opp = opps[i < 4 ? i : i - 1]!;
    const g = createGame(ctx, team.id, season.id, {
      week, kind: 'regular', opponentId: opp.id, location: i % 2 === 0 ? 'home' : 'away', scheduledAt: zonedToUtcIso(d, { h: 19, min: 0 }, team.timezone), notes: '',
    });
    games.push(g.id);
    week++;
  }

  console.log('');
  console.log('=== FootballOS DEMO seed (fictional data; environmentKind=demo) ===');
  console.log(`data dir : ${config.dataDir}`);
  console.log(`team     : ${team.name}  id=${team.id}`);
  console.log(`season   : ${season.label}  id=${season.id}  games=${games.length} + 1 bye, opponents=${opps.length}`);
  console.log('');
  console.log('Credentials below are printed ONCE and never stored in plain text. Demo use only.');
  for (const c of credentials) {
    console.log(`- ${c.role.padEnd(14)} ${c.email}`);
    console.log(`    password   : ${c.password}`);
    if (c.totpSecret) console.log(`    TOTP secret: ${c.totpSecret}  (add to an authenticator app; MFA is required for this role)`);
  }
  console.log('');
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => close());
