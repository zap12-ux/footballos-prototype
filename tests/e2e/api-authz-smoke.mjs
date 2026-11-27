#!/usr/bin/env node
// Independent QA smoke for apps/api authorization and failure paths (task A6, check 2).
// Plain Node >= 22, no dependencies. Runs against a live API with a team set up by `npm run bootstrap -w apps/api` and invited staff.
//
// Credentials come from the environment (parse them from the seed output; never paste them here):
//   FOS_URL            e.g. http://127.0.0.1:8792
//   FOS_HC_EMAIL / FOS_HC_PASSWORD / FOS_HC_TOTP     head coach (MFA enrolled at seed time)
//   FOS_OC_EMAIL / FOS_OC_PASSWORD / FOS_OC_TOTP     offensive coordinator
//   FOS_PC_EMAIL / FOS_PC_PASSWORD                   position coach (no MFA)
//   FOS_OTHER_TEAM_ID (optional)   a team the position coach is NOT a member of (cross-team 404 check)
//   FOS_OTHER_GAME_ID (optional)   a game in that other team
//   FOS_LOG (optional)             path of the server log, to confirm the demo recovery token is written there
//
// Usage: node tests/e2e/api-authz-smoke.mjs

import { createHmac } from 'node:crypto';
import fs from 'node:fs';

const URL_ = (process.env.FOS_URL || 'http://127.0.0.1:8792').replace(/\/+$/, '');
const API = URL_ + '/api/v1';
const env = (k, required = true) => {
  const v = process.env[k];
  if (required && !v) {
    console.error(`missing ${k}`);
    process.exit(2);
  }
  return v;
};
const HC = { email: env('FOS_HC_EMAIL'), password: env('FOS_HC_PASSWORD'), totp: env('FOS_HC_TOTP') };
const OC = { email: env('FOS_OC_EMAIL'), password: env('FOS_OC_PASSWORD'), totp: env('FOS_OC_TOTP') };
const PC = { email: env('FOS_PC_EMAIL'), password: env('FOS_PC_PASSWORD') };
const OTHER_TEAM = env('FOS_OTHER_TEAM_ID', false);
const OTHER_GAME = env('FOS_OTHER_GAME_ID', false);
const LOG = env('FOS_LOG', false);

// ---------- reporting ----------
const results = [];
function check(name, ok, evidence) {
  results.push({ name, ok, evidence: String(evidence ?? '') });
  console.log(`${ok === 'SKIP' ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  -- ${String(evidence).slice(0, 220)}` : ''}`);
}
function finish() {
  const pass = results.filter((r) => r.ok === true).length;
  const fail = results.filter((r) => r.ok === false).length;
  const skip = results.filter((r) => r.ok === 'SKIP').length;
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail ? 1 : 0);
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------
function base32Decode(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const v = alphabet.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

// ---------- http with a cookie jar per client ----------
function client() {
  const jar = new Map();
  async function req(method, p, { body, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (jar.size) h.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined && !raw) h['content-type'] = 'application/json';
    const res = await fetch(API + p, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = sc.split(';');
      const [k, v] = pair.split('=');
      if (v === '' || attrs.some((a) => /max-age=0|expires=Thu, 01 Jan 1970/i.test(a))) jar.delete(k.trim());
      else jar.set(k.trim(), v);
    }
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers, setCookie: res.headers.getSetCookie?.() ?? [] };
  }
  return { req, jar };
}
const code = (r) => r.body?.error?.code;

// ---------- 0. health ----------
const health = await fetch(URL_ + '/healthz').then(async (r) => ({ status: r.status, body: await r.json() }));
check('GET /healthz is public and labels the environment', health.status === 200 && health.body.ok === true && health.body.environment, JSON.stringify(health.body));
const unauth = client();
check('unauthenticated GET /api/v1/teams -> 401 unauthorized', (await unauth.req('GET', '/teams')).status === 401);
check('unauthenticated GET /api/v1/auth/me -> 401', (await unauth.req('GET', '/auth/me')).status === 401);

// ---------- 1. sign-in failure paths ----------
const bad = client();
const wrong = await bad.req('POST', '/auth/sign-in', { body: { email: PC.email, password: 'definitely-not-the-password' } });
check('wrong password -> 401 unauthorized, no cookie set', wrong.status === 401 && code(wrong) === 'unauthorized' && wrong.setCookie.length === 0, `${wrong.status} ${code(wrong)}`);
const unknownUser = await bad.req('POST', '/auth/sign-in', { body: { email: 'nobody@demo.footballos.test', password: 'definitely-not-the-password' } });
check('unknown e-mail -> same 401 envelope as wrong password (no account enumeration)', unknownUser.status === 401 && unknownUser.body?.error?.message === wrong.body?.error?.message, `${unknownUser.status} "${unknownUser.body?.error?.message}"`);
const malformed = await bad.req('POST', '/auth/sign-in', { body: { email: 'not-an-email', password: '' } });
check('malformed sign-in body -> 400 validation_error with issues', malformed.status === 400 && code(malformed) === 'validation_error' && Array.isArray(malformed.body?.error?.details?.issues), `${malformed.status} ${code(malformed)}`);
const notJson = await bad.req('POST', '/auth/sign-in', { body: 'x=1', raw: true, headers: { 'content-type': 'application/json' } });
check('non-JSON body -> 400 (not 500)', notJson.status === 400, `${notJson.status} ${code(notJson)}`);

// rate limiting: hammer a throwaway e-mail until 429
const rl = client();
let rlStatus = null;
let attempts = 0;
for (let i = 0; i < 25; i++) {
  attempts++;
  const r = await rl.req('POST', '/auth/sign-in', { body: { email: 'ratelimit.probe@demo.footballos.test', password: 'wrong-password-value' } });
  if (r.status === 429) {
    rlStatus = r;
    break;
  }
}
check('repeated failed sign-ins -> 429 rate_limited with details.retryAfterSec', rlStatus?.status === 429 && code(rlStatus) === 'rate_limited' && Number.isFinite(rlStatus.body?.error?.details?.retryAfterSec), rlStatus ? `after ${attempts} attempts; retryAfterSec=${rlStatus.body?.error?.details?.retryAfterSec}` : `no 429 after ${attempts} attempts`);
const rlOther = await rl.req('POST', '/auth/sign-in', { body: { email: PC.email, password: PC.password } });
check('rate limit is per e-mail (another account from the same IP still signs in)', rlOther.status === 200, `${rlOther.status}`);
await rl.req('POST', '/auth/sign-out');

// ---------- 2. position coach: sign-in success, no MFA requirement, role 403s ----------
const pc = client();
const pcIn = await pc.req('POST', '/auth/sign-in', { body: { email: PC.email, password: PC.password } });
const cookieAttrs = pcIn.setCookie.join(' | ');
check('position coach sign-in -> 200 with AuthState and memberships', pcIn.status === 200 && pcIn.body?.user?.email === PC.email && pcIn.body.memberships?.length === 1 && pcIn.body.mfaRequired === false && pcIn.body.mfaEnrollmentRequired === false, `mfaRequired=${pcIn.body?.mfaRequired} enroll=${pcIn.body?.mfaEnrollmentRequired}`);
check('session cookie is HttpOnly + SameSite=Lax and the body never carries a password hash', /fos_session=/.test(cookieAttrs) && /httponly/i.test(cookieAttrs) && /samesite=lax/i.test(cookieAttrs) && !JSON.stringify(pcIn.body).includes('passwordHash'), cookieAttrs.replace(/fos_session=[^;]+/, 'fos_session=<redacted>'));
const teamId = pcIn.body.memberships[0].teamId;
const teams = await pc.req('GET', '/teams');
check('GET /teams lists only the demo team, labeled environmentKind=demo', teams.status === 200 && teams.body.items.length === 1 && teams.body.items[0].environmentKind === 'demo' && /\(demo\)/.test(teams.body.items[0].name), `${teams.body?.items?.[0]?.name}`);
const inv403 = await pc.req('POST', `/teams/${teamId}/invites`, { body: { email: 'new.coach@demo.footballos.test', role: 'viewer' } });
check('position coach creating an invite -> 403 forbidden', inv403.status === 403 && code(inv403) === 'forbidden', `${inv403.status} ${code(inv403)}`);
check('position coach listing invites -> 403', (await pc.req('GET', `/teams/${teamId}/invites`)).status === 403);
check('position coach reading audit log -> 403', (await pc.req('GET', `/teams/${teamId}/audit`)).status === 403);
const seasons = await pc.req('GET', `/teams/${teamId}/seasons`);
const seasonId = seasons.body?.items?.[0]?.id;
check('position coach can read seasons (any membership)', seasons.status === 200 && seasonId, `${seasons.body?.items?.length} seasons`);
check('position coach creating a season -> 403', (await pc.req('POST', `/teams/${teamId}/seasons`, { body: { label: 'QA', startsOn: '2027-08-01', endsOn: '2027-12-01' } })).status === 403);
const games = await pc.req('GET', `/teams/${teamId}/seasons/${seasonId}/games`);
const game = games.body?.items?.find((g) => g.kind === 'regular');
check('games list carries the computed season record', games.status === 200 && games.body.record && typeof games.body.record.wins === 'number', JSON.stringify(games.body?.record));
check('position coach PATCH /games/:id -> 403', (await pc.req('PATCH', `/games/${game.id}`, { body: { expectedVersion: game.version, notes: 'qa' } })).status === 403);
check('position coach schedule import preview -> 403', (await pc.req('POST', `/teams/${teamId}/schedule-imports`, { body: { seasonId, filename: 'x.csv', content: 'week,date,opponent\n1,2027-09-03,Foo' } })).status === 403);
const patchStaff = await pc.req('PATCH', `/teams/${teamId}/staff/${pcIn.body.memberships[0].id}`, { body: { role: 'head_coach' } });
check('position coach promoting themself via PATCH staff -> 403', patchStaff.status === 403, `${patchStaff.status}`);

// cross-team: unknown ids and (if provided) a real other team
const randomTeam = crypto.randomUUID();
const ct1 = await pc.req('GET', `/teams/${randomTeam}`);
const ct2 = await pc.req('POST', `/teams/${randomTeam}/invites`, { body: { email: 'x@demo.footballos.test', role: 'viewer' } });
check('non-member team id -> 404 not_found (never 403), also on a write route', ct1.status === 404 && code(ct1) === 'not_found' && ct2.status === 404, `${ct1.status}/${ct2.status}`);
if (OTHER_TEAM) {
  const o1 = await pc.req('GET', `/teams/${OTHER_TEAM}`);
  const o2 = await pc.req('GET', `/teams/${OTHER_TEAM}/staff`);
  const o3 = await pc.req('GET', `/teams/${OTHER_TEAM}/seasons`);
  const o4 = OTHER_GAME ? await pc.req('GET', `/games/${OTHER_GAME}`) : { status: 404 };
  const o5 = OTHER_GAME ? await pc.req('PATCH', `/games/${OTHER_GAME}`, { body: { expectedVersion: 1, notes: 'x' } }) : { status: 404 };
  check('existing other team -> 404 on team, staff, seasons, game read and game write (no existence leak)', [o1, o2, o3, o4, o5].every((r) => r.status === 404), `${o1.status}/${o2.status}/${o3.status}/${o4.status}/${o5.status}`);
} else {
  check('existing other team -> 404 (set FOS_OTHER_TEAM_ID to run)', 'SKIP');
}

// cookie tampering
const tampered = client();
const sess = pc.jar.get('fos_session');
tampered.jar.set('fos_session', sess.slice(0, -4) + (sess.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
check('tampered session cookie -> 401', (await tampered.req('GET', '/auth/me')).status === 401);
const out = await pc.req('POST', '/auth/sign-out');
check('sign-out clears the cookie and the old session is rejected afterwards', out.status === 200 && (await pc.req('GET', '/auth/me')).status === 401);

// ---------- 3. head coach: MFA gate, then full access ----------
const hc = client();
const hcIn = await hc.req('POST', '/auth/sign-in', { body: { email: HC.email, password: HC.password } });
check('head coach sign-in -> 200 with mfaRequired=true', hcIn.status === 200 && hcIn.body?.mfaRequired === true, `mfaRequired=${hcIn.body?.mfaRequired}`);
const gated = await hc.req('GET', '/teams');
check('MFA-pending session on a protected route -> 401 with details.mfaRequired', gated.status === 401 && gated.body?.error?.details?.mfaRequired === true, `${gated.status} ${JSON.stringify(gated.body?.error?.details)}`);
check('MFA-pending session may still call /auth/me', (await hc.req('GET', '/auth/me')).status === 200);
const badCode = await hc.req('POST', '/auth/mfa/verify', { body: { code: '000000' } });
check('wrong TOTP -> 401 (mfaRequired)', badCode.status === 401 && badCode.body?.error?.details?.mfaRequired === true, `${badCode.status}`);
const goodCode = await hc.req('POST', '/auth/mfa/verify', { body: { code: totp(HC.totp) } });
check('correct TOTP -> 200 mfaVerified', goodCode.status === 200 && goodCode.body?.mfaVerified === true, `${goodCode.status} ${JSON.stringify(goodCode.body).slice(0, 80)}`);
const hcTeams = await hc.req('GET', '/teams');
check('after MFA the head coach reaches protected routes', hcTeams.status === 200);
const audit = await hc.req('GET', `/teams/${teamId}/audit?limit=5`);
check('head coach reads the audit log (paginated)', audit.status === 200 && Array.isArray(audit.body.items) && 'nextCursor' in audit.body, `${audit.body?.items?.length} items`);

// version conflict on a game
const g = (await hc.req('GET', `/games/${game.id}`)).body;
const ok1 = await hc.req('PATCH', `/games/${game.id}`, { body: { expectedVersion: g.version, notes: 'qa edit 1' } });
const stale = await hc.req('PATCH', `/games/${game.id}`, { body: { expectedVersion: g.version, notes: 'qa edit 2 (stale)' } });
check('PATCH game with current version -> 200 and version+1; stale expectedVersion -> 409 conflict with currentVersion', ok1.status === 200 && ok1.body.version === g.version + 1 && stale.status === 409 && code(stale) === 'conflict' && stale.body.error.details?.currentVersion === g.version + 1, `${ok1.status} v${ok1.body?.version}; ${stale.status} ${code(stale)} current=${stale.body?.error?.details?.currentVersion}`);
const badTransition = await hc.req('PATCH', `/games/${game.id}`, { body: { expectedVersion: g.version + 1, status: 'final', result: null } });
check('final without a result (or other disallowed transition) is refused, not stored', badTransition.status === 409 || badTransition.status === 400, `${badTransition.status} ${code(badTransition)} ${badTransition.body?.error?.message ?? ''}`);
const inconsistent = await hc.req('PATCH', `/games/${game.id}`, { body: { expectedVersion: g.version + 1, status: 'final', result: { ourScore: 10, theirScore: 20, outcome: 'win' } } });
check('score/outcome inconsistency is rejected with 400 validation_error', inconsistent.status === 400 && code(inconsistent) === 'validation_error', `${inconsistent.status} ${code(inconsistent)}`);

// schedule import preview with a bad row
const csv = ['week,date,opponent,location', '1,2027-09-03,QA Opp A,home', '2,not-a-date,QA Opp B,away', '2,2027-09-17,,home', 'xx,2027-09-24,QA Opp C,neutral'].join('\n');
const prev = await hc.req('POST', `/teams/${teamId}/schedule-imports`, { body: { seasonId, filename: 'qa.csv', content: csv } });
const errs = prev.body?.errors ?? [];
check('schedule import preview reports row errors (bad date, missing opponent, duplicate week, bad week) and keeps valid rows', prev.status === 201 && prev.body.status === 'previewed' && errs.length >= 3 && errs.every((e) => typeof e.row === 'number' && typeof e.message === 'string') && prev.body.rows?.length === 1, `status=${prev.body?.status} errors=${errs.length} rows=${prev.body?.rows?.length}: ${errs.map((e) => `r${e.row} ${e.column}`).join(', ')}`);
const applyRefused = await hc.req('POST', `/schedule-imports/${prev.body.id}/apply`, { body: {} });
check('apply with row errors and skipInvalidRows=false -> 409 conflict', applyRefused.status === 409 && code(applyRefused) === 'conflict', `${applyRefused.status} ${code(applyRefused)}`);
const discard = await hc.req('POST', `/schedule-imports/${prev.body.id}/discard`);
check('discard import -> status discarded', discard.status === 200 && discard.body.status === 'discarded', `${discard.body?.status}`);
const noOpp = await hc.req('POST', `/teams/${teamId}/schedule-imports`, { body: { seasonId, filename: 'x.csv', content: 'a,b\n1,2' } });
check('CSV without an opponent column is a row-1 error, not a crash', noOpp.status === 201 && (noOpp.body.errors ?? []).some((e) => e.row === 1), `${noOpp.status} ${noOpp.body?.errors?.[0]?.message ?? ''}`);

// ---------- 4. invite flow ----------
const inviteEmail = `qa.invitee.${Date.now()}@demo.footballos.test`;
const created = await hc.req('POST', `/teams/${teamId}/invites`, { body: { email: inviteEmail, role: 'position_coach', unit: 'offense', expiresInHours: 1 } });
check('head coach creates an invite -> 201 with a one-time token', created.status === 201 && typeof created.body.token === 'string' && created.body.token.length >= 16, `${created.status}`);
const listed = await hc.req('GET', `/teams/${teamId}/invites`);
check('open invites list never returns the raw token', listed.status === 200 && listed.body.items.some((i) => i.email === inviteEmail) && !JSON.stringify(listed.body).includes(created.body.token));
const acceptor = client();
const weak = await acceptor.req('POST', `/auth/invites/${created.body.token}/accept`, { body: { displayName: 'QA Invitee', password: 'short' } });
check('accept with a short password -> 400 validation_error', weak.status === 400 && code(weak) === 'validation_error');
const badTokenAccept = await acceptor.req('POST', `/auth/invites/${'x'.repeat(40)}/accept`, { body: { displayName: 'QA Invitee', password: 'a-long-enough-password-123' } });
check('accept with an unknown token -> 404 (or 410) and no session', (badTokenAccept.status === 404 || badTokenAccept.status === 410) && badTokenAccept.setCookie.length === 0, `${badTokenAccept.status} ${code(badTokenAccept)}`);
const accepted = await acceptor.req('POST', `/auth/invites/${created.body.token}/accept`, { body: { displayName: 'QA Invitee', password: 'a-long-enough-password-123' } });
check('accept invite -> 201, signed in as the new position coach of the demo team', accepted.status === 201 && accepted.body?.user?.email === inviteEmail && accepted.body.memberships?.[0]?.teamId === teamId && accepted.body.memberships[0].role === 'position_coach', `${accepted.status} role=${accepted.body?.memberships?.[0]?.role}`);
const reuse = await client().req('POST', `/auth/invites/${created.body.token}/accept`, { body: { displayName: 'Again', password: 'a-long-enough-password-123' } });
check('accepting the same invite twice is refused', reuse.status >= 400 && reuse.status < 500, `${reuse.status} ${code(reuse)}`);
const inviteeMe = await acceptor.req('GET', '/auth/me');
check('invitee session works on /auth/me', inviteeMe.status === 200);
const auditAfter = await hc.req('GET', `/teams/${teamId}/audit?limit=20`);
check('audit log records invite created and accepted', auditAfter.status === 200 && auditAfter.body.items.some((a) => /invite/i.test(a.action)), `actions: ${[...new Set(auditAfter.body?.items?.map((a) => a.action))].join(', ')}`);

// ---------- 5. recovery flow ----------
const logBefore = LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').length : 0;
const rec = await client().req('POST', '/auth/recovery/request', { body: { email: inviteEmail } });
const recUnknown = await client().req('POST', '/auth/recovery/request', { body: { email: 'nobody.' + Date.now() + '@demo.footballos.test' } });
check('recovery request -> 202 for known and unknown e-mail alike (no enumeration), body carries no token', rec.status === 202 && recUnknown.status === 202 && !JSON.stringify(rec.body).match(/token/i), `${rec.status}/${recUnknown.status} ${JSON.stringify(rec.body)}`);
let recoveryToken = null;
if (LOG && fs.existsSync(LOG)) {
  await new Promise((r) => setTimeout(r, 300));
  const tail = fs.readFileSync(LOG, 'utf8').slice(logBefore);
  const m = tail.match(/"unredacted_recovery_token":"([^"]+)"/);
  recoveryToken = m ? m[1] : null;
  check('demo environment writes the recovery token to the server log (field unredacted_recovery_token) with a demo/development-only warning', Boolean(recoveryToken) && /demo\/development only/.test(tail), recoveryToken ? 'token found in log (not shown)' : 'not found in log tail');
} else {
  check('recovery token appears in the server log (set FOS_LOG to run)', 'SKIP');
}
if (recoveryToken) {
  const badComplete = await client().req('POST', '/auth/recovery/complete', { body: { token: 'y'.repeat(40), newPassword: 'another-long-password-456' } });
  check('recovery complete with a wrong token is refused', badComplete.status >= 400 && badComplete.status < 500, `${badComplete.status} ${code(badComplete)}`);
  const complete = await client().req('POST', '/auth/recovery/complete', { body: { token: recoveryToken, newPassword: 'another-long-password-456' } });
  check('recovery complete with the logged token -> 200', complete.status === 200 && complete.body?.ok === true, `${complete.status}`);
  const oldPw = await client().req('POST', '/auth/sign-in', { body: { email: inviteEmail, password: 'a-long-enough-password-123' } });
  const newPw = await client().req('POST', '/auth/sign-in', { body: { email: inviteEmail, password: 'another-long-password-456' } });
  const oldSession = await acceptor.req('GET', '/auth/me');
  check('old password rejected, new password accepted, pre-recovery session revoked', oldPw.status === 401 && newPw.status === 200 && oldSession.status === 401, `old=${oldPw.status} new=${newPw.status} oldSession=${oldSession.status}`);
  const replay = await client().req('POST', '/auth/recovery/complete', { body: { token: recoveryToken, newPassword: 'yet-another-long-password-789' } });
  check('recovery token is single-use', replay.status >= 400 && replay.status < 500, `${replay.status} ${code(replay)}`);
}

// ---------- 6. coordinator MFA + staff management denial ----------
const oc = client();
const ocIn = await oc.req('POST', '/auth/sign-in', { body: { email: OC.email, password: OC.password } });
await oc.req('POST', '/auth/mfa/verify', { body: { code: totp(OC.totp) } });
check('coordinator sign-in + TOTP -> reaches /teams', ocIn.status === 200 && (await oc.req('GET', '/teams')).status === 200);
check('coordinator creating an invite -> 403 (head coach only)', (await oc.req('POST', `/teams/${teamId}/invites`, { body: { email: 'z@demo.footballos.test', role: 'viewer' } })).status === 403);
check('coordinator may create an opponent (schedule management)', (await oc.req('POST', `/teams/${teamId}/opponents`, { body: { name: 'QA Opponent (demo)' } })).status === 201);
const usage = await oc.req('GET', `/teams/${teamId}/usage`);
check('usage route returns zeros until cost rows exist', usage.status === 200 && usage.body.costUsd === 0, JSON.stringify(usage.body).slice(0, 120));

// ---------- 7. routes promised by CONTRACTS §12 but not yet implemented ----------
const notYet = [];
for (const [m, p] of [['GET', `/teams/${teamId}/jobs`], ['GET', `/assets/${crypto.randomUUID()}`], ['GET', `/media/${crypto.randomUUID()}/stream?token=x`], ['GET', `/games/${game.id}/plans/offense`], ['GET', `/plan-versions/x/export.pdf`]]) {
  const r = await client().req(m, p);
  notYet.push(`${p.split('?')[0].split('/')[1]}=${r.status}`);
}
check('unauthenticated media/export/jobs routes are not reachable (404 not implemented, never 200)', notYet.every((s) => /=(404|401)$/.test(s)), notYet.join(' '));

finish();
