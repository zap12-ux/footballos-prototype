import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Role, Unit } from '@footballos/contracts';
import { loadConfig } from '../config.js';
import { buildContext, type BuiltContext } from '../bootstrap-context.js';
import { createApp, type AppType } from '../app.js';
import { createLogger } from '../logger.js';
import { newTotpSecret, currentTotp } from '../auth/totp.js';
import { createUser, enrollMfaDirect } from '../services/users.js';
import { addMembership, createTeam } from '../services/teams.js';
import { createSeason } from '../services/schedule.js';

export type TestApp = {
  app: AppType;
  ctx: BuiltContext['ctx'];
  dataDir: string;
  logLines: string[];
  clock: { now: Date; advanceMs: (ms: number) => void };
  close: () => void;
};

/** Fresh temp data dir, fresh SQLite database with migrations applied, silent logger captured in memory. */
export function makeTestApp(envOverrides: Record<string, string> = {}): TestApp {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'footballos-api-test-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    FOOTBALLOS_ENV: 'development',
    FOOTBALLOS_DATA_DIR: dataDir,
    SESSION_SECRET: 'test-session-secret-at-least-32-characters-long-xyz',
    LOG_LEVEL: 'debug',
    SIGN_IN_RATE_LIMIT_MAX: '3',
    SIGN_IN_RATE_LIMIT_WINDOW_SEC: '60',
    PASSWORD_SCRYPT_LOG2N: '12',
    ...envOverrides,
  });
  const logLines: string[] = [];
  const logger = createLogger('debug', {}, (l) => logLines.push(l));
  const clock = { now: new Date('2026-10-25T12:00:00.000Z'), advanceMs: (ms: number) => { clock.now = new Date(clock.now.getTime() + ms); } };
  const built = buildContext({ config, logger, now: () => clock.now });
  const app = createApp(built.ctx);
  return {
    app, ctx: built.ctx, dataDir, logLines, clock,
    close: () => { built.close(); fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}

export type Res = { status: number; body: any; cookie: string | null; headers: Headers };

/** Calls the app in-process. `cookie` is the raw Cookie header value from a previous response. */
export async function call(t: TestApp, method: string, path: string, body?: unknown, cookie?: string | null, extraHeaders: Record<string, string> = {}): Promise<Res> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers['cookie'] = cookie;
  const res = await t.app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  const setCookie = res.headers.get('set-cookie');
  let cookieOut: string | null = null;
  if (setCookie) {
    const first = setCookie.split(';')[0]!;
    cookieOut = first.endsWith('=') ? null : first; // deleted cookie → null
  }
  return { status: res.status, body: json, cookie: cookieOut, headers: res.headers };
}

export const PASSWORD = 'correct-horse-battery-staple';

export async function seedUser(t: TestApp, email: string, opts: { mfa?: boolean; password?: string } = {}) {
  const user = await createUser(t.ctx, { email, displayName: email.split('@')[0]!, password: opts.password ?? PASSWORD });
  let totpSecret: string | null = null;
  if (opts.mfa) { totpSecret = newTotpSecret(); enrollMfaDirect(t.ctx, user.id, totpSecret); }
  return { user, totpSecret };
}

export function seedTeam(t: TestApp, name = 'Test Team (demo)') {
  const team = createTeam(t.ctx, { name, shortName: name.slice(0, 3).toUpperCase(), level: 'high_school', environmentKind: 'demo', timezone: 'America/New_York' });
  const season = createSeason(t.ctx, team.id, { label: '2026', startsOn: '2026-08-01', endsOn: '2026-12-15', isCurrent: true });
  return { team, season };
}

export function addStaff(t: TestApp, teamId: string, userId: string, role: Role, units: Unit[] = []) {
  return addMembership(t.ctx, { teamId, userId, role, units });
}

/** Signs in and, when the user has MFA, completes TOTP verification. Returns the cookie. */
export async function signIn(t: TestApp, email: string, totpSecret?: string | null, password = PASSWORD): Promise<string> {
  const res = await call(t, 'POST', '/api/v1/auth/sign-in', { email, password });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  let cookie = res.cookie!;
  if (totpSecret) {
    const v = await call(t, 'POST', '/api/v1/auth/mfa/verify', { code: currentTotp(totpSecret) }, cookie);
    if (v.status !== 200) throw new Error(`mfa verify failed: ${v.status} ${JSON.stringify(v.body)}`);
    cookie = v.cookie ?? cookie;
  }
  return cookie;
}

/** Full fixture: one team with a head coach (MFA), coordinator (MFA), position coach, analyst and viewer, all signed in. */
export async function seedTeamWithStaff(t: TestApp, name = 'Alpha (demo)') {
  const { team, season } = seedTeam(t, name);
  const tag = name.replace(/[^a-z]/gi, '').toLowerCase();
  const hc = await seedUser(t, `hc@${tag}.test`, { mfa: true });
  const oc = await seedUser(t, `oc@${tag}.test`, { mfa: true });
  const pc = await seedUser(t, `pc@${tag}.test`);
  const an = await seedUser(t, `an@${tag}.test`);
  const vw = await seedUser(t, `vw@${tag}.test`);
  addStaff(t, team.id, hc.user.id, 'head_coach', ['offense', 'defense', 'special_teams']);
  addStaff(t, team.id, oc.user.id, 'coordinator', ['offense']);
  addStaff(t, team.id, pc.user.id, 'position_coach', ['offense']);
  addStaff(t, team.id, an.user.id, 'analyst');
  addStaff(t, team.id, vw.user.id, 'viewer');
  return {
    team, season,
    hc: { ...hc, cookie: await signIn(t, hc.user.email, hc.totpSecret) },
    oc: { ...oc, cookie: await signIn(t, oc.user.email, oc.totpSecret) },
    pc: { ...pc, cookie: await signIn(t, pc.user.email) },
    an: { ...an, cookie: await signIn(t, an.user.email) },
    vw: { ...vw, cookie: await signIn(t, vw.user.email) },
  };
}
