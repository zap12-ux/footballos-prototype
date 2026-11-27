// Shared helpers for the Milestone B QA scripts (task B6). Plain Node >= 22, no dependencies.
// Credentials come from the environment only (the staff you created with `npm run bootstrap` and invites):
//   FOS_URL                      e.g. http://127.0.0.1:8792
//   FOS_HC_EMAIL / FOS_HC_PASSWORD / FOS_HC_TOTP     head coach (MFA enrolled at seed time)
//   FOS_OC_EMAIL / FOS_OC_PASSWORD / FOS_OC_TOTP     coordinator
//   FOS_PC_EMAIL / FOS_PC_PASSWORD                   position coach (no MFA)
//   FOS_AN_EMAIL / FOS_AN_PASSWORD                   analyst (no MFA)
//   FOS_T2_EMAIL / FOS_T2_PASSWORD                   a user of a SECOND team (api-create-second-team.mjs)
//   FOS_DATA_DIR                 the server's FOOTBALLOS_DATA_DIR (file-system assertions)
//   FOS_LOG                      the server log (token-leak assertions)

import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const URL_ = (process.env.FOS_URL || 'http://127.0.0.1:8792').replace(/\/+$/, '');
export const API = URL_ + '/api/v1';
export const DATA_DIR = process.env.FOS_DATA_DIR || '';
export const LOG = process.env.FOS_LOG || '';
export const DEMO_FILM = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'fixtures', 'media', 'clips');

export function env(k, required = true) {
  const v = process.env[k];
  if (required && !v) {
    console.error(`missing ${k}`);
    process.exit(2);
  }
  return v;
}

// ---------- reporting ----------
export const results = [];
export function check(name, ok, evidence) {
  results.push({ name, ok, evidence: String(evidence ?? '') });
  console.log(`${ok === 'SKIP' ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${evidence !== undefined && evidence !== '' ? `  -- ${String(evidence).slice(0, 300)}` : ''}`);
  return ok === true;
}
export function note(msg) {
  console.log(`NOTE  ${msg}`);
}
export function finish() {
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
export function totp(secret, at = Date.now()) {
  const counter = Math.floor(at / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

// ---------- http client with a cookie jar ----------
export function client() {
  const jar = new Map();
  async function req(method, p, { body, headers = {}, raw = false, absolute = false, binary = false } = {}) {
    const h = { ...headers };
    if (jar.size) h.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined && !raw) h['content-type'] = 'application/json';
    const url = absolute ? p : API + p;
    const res = await fetch(url, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = sc.split(';');
      const [k, v] = pair.split('=');
      if (v === '' || attrs.some((a) => /max-age=0|expires=Thu, 01 Jan 1970/i.test(a))) jar.delete(k.trim());
      else jar.set(k.trim(), v);
    }
    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: buf, headers: res.headers };
    }
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers, text };
  }
  return { req, jar };
}
export const code = (r) => r.body?.error?.code;
export const details = (r) => r.body?.error?.details;

/** Signs in as one of the seeded roles: 'pc' | 'an' (no MFA), 'hc' | 'oc' (TOTP from env), 't2' (second team). */
export async function signIn(role) {
  const c = client();
  const map = {
    pc: ['FOS_PC_EMAIL', 'FOS_PC_PASSWORD', null],
    an: ['FOS_AN_EMAIL', 'FOS_AN_PASSWORD', null],
    hc: ['FOS_HC_EMAIL', 'FOS_HC_PASSWORD', 'FOS_HC_TOTP'],
    oc: ['FOS_OC_EMAIL', 'FOS_OC_PASSWORD', 'FOS_OC_TOTP'],
    t2: ['FOS_T2_EMAIL', 'FOS_T2_PASSWORD', null],
  }[role];
  const r = await c.req('POST', '/auth/sign-in', { body: { email: env(map[0]), password: env(map[1]) } });
  if (r.status !== 200) throw new Error(`sign-in as ${role} failed: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  if (map[2]) {
    const v = await c.req('POST', '/auth/mfa/verify', { body: { code: totp(env(map[2])) } });
    if (v.status !== 200) throw new Error(`MFA for ${role} failed: ${v.status}`);
  }
  const me = await c.req('GET', '/auth/me');
  c.user = me.body.user;
  c.memberships = me.body.memberships;
  c.teamId = me.body.memberships[0]?.teamId;
  return c;
}

/** First scheduled game with an opponent in the current season of the client's first team. */
export async function pickGame(c, teamId = c.teamId) {
  const seasons = await c.req('GET', `/teams/${teamId}/seasons`);
  const season = seasons.body.items.find((s) => s.isCurrent) ?? seasons.body.items[0];
  const games = await c.req('GET', `/teams/${teamId}/seasons/${season.id}/games`);
  const list = games.body.items ?? games.body.games ?? [];
  const game = list.find((g) => g.opponentId);
  if (!game) throw new Error('no game with an opponent in the seeded season');
  return { season, game, games: list };
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export const DEFAULT_CONTEXT = { analyzedTeam: 'opponent', analyzedUnit: 'offense', perspective: 'sideline_fixed', teamCues: 'white jerseys (demo)' };

/** Creates an upload for `buf` and sends chunks of `chunkBytes` contiguously; `stopAfterChunks` ends early (for resume tests). */
export async function uploadBytes(c, gameId, buf, { filename, chunkBytes, context = DEFAULT_CONTEXT, sha256, stopAfterChunks = Infinity, mimeType = 'video/mp4', complete = true } = {}) {
  const create = await c.req('POST', `/games/${gameId}/uploads`, { body: { filename, byteSize: buf.length, mimeType, ...(sha256 ? { sha256 } : {}), context } });
  if (create.status !== 201) return { create };
  const upload = create.body.upload;
  const chunks = await putChunks(c, upload.id, buf, chunkBytes, 0, stopAfterChunks);
  let done = null;
  if (complete && chunks.receivedBytes === buf.length) done = await c.req('POST', `/uploads/${upload.id}/complete`, { body: {} });
  return { create, upload, asset: create.body.asset, chunks, complete: done };
}

export async function putChunks(c, uploadId, buf, chunkBytes, fromByte = 0, maxChunks = Infinity) {
  let sent = 0;
  let receivedBytes = fromByte;
  let last = null;
  for (let start = fromByte; start < buf.length && sent < maxChunks; start += chunkBytes) {
    const end = Math.min(start + chunkBytes, buf.length) - 1;
    last = await c.req('PUT', `/uploads/${uploadId}`, { raw: true, body: buf.subarray(start, end + 1), headers: { 'content-range': `bytes ${start}-${end}/${buf.length}`, 'content-type': 'application/octet-stream' } });
    if (last.status !== 200) return { sent, receivedBytes, last };
    receivedBytes = last.body.receivedBytes;
    sent += 1;
  }
  return { sent, receivedBytes, last };
}

export async function listJobs(c, teamId, assetId) {
  const r = await c.req('GET', `/teams/${teamId}/jobs?assetId=${assetId}&limit=200`);
  return r.body.items ?? [];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls the asset's jobs until `pred(jobs)` is true or the timeout elapses. Returns the last job list. */
export async function waitJobs(c, teamId, assetId, pred, { timeoutMs = 600_000, everyMs = 500 } = {}) {
  const t0 = Date.now();
  let jobs = [];
  while (Date.now() - t0 < timeoutMs) {
    jobs = await listJobs(c, teamId, assetId);
    if (pred(jobs)) return jobs;
    await sleep(everyMs);
  }
  return jobs;
}

export const isTerminal = (j) => ['succeeded', 'failed', 'canceled'].includes(j.status);
export const chainOf = (jobs) => Object.fromEntries(jobs.filter((j) => ['validate', 'proxy', 'thumbnails', 'segment'].includes(j.kind)).map((j) => [j.kind, j]));
export const summarizeJobs = (jobs) => jobs.map((j) => `${j.kind}:${j.status}${j.attempt ? `#${j.attempt}` : ''}${j.error ? `(${j.error.code})` : ''}`).join(' ');

export function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}
export function writeState(file, state) {
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Media directory of an asset under FOS_DATA_DIR (empty string when FOS_DATA_DIR is not set). */
export function assetDir(teamId, assetId) {
  return DATA_DIR ? path.join(DATA_DIR, 'media', teamId, assetId) : '';
}
export function listAssetDirs(teamId) {
  const dir = DATA_DIR ? path.join(DATA_DIR, 'media', teamId) : '';
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}
export function logContains(needle) {
  if (!LOG || !fs.existsSync(LOG)) return null;
  return fs.readFileSync(LOG, 'utf8').includes(needle);
}
