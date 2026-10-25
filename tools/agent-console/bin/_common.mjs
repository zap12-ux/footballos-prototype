// Shared helpers for the plain-Node CLIs. No build step, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = process.env.CONSOLE_REPO_ROOT || path.resolve(packageDir, '..', '..');
export const dataDir = process.env.CONSOLE_DATA_DIR || process.env.DATA_DIR || path.join(repoRoot, '.data', 'console');
export const consoleUrl = (process.env.CONSOLE_URL || 'http://127.0.0.1:4800').replace(/\/+$/, '');

/** Parse `--flag value`, `--flag=value`, bare `--flag` (true) and positionals. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

export const splitList = (v) =>
  v === undefined || v === true || v === ''
    ? []
    : String(v)
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean);

export const splitPipe = (v) =>
  v === undefined || v === true || v === ''
    ? []
    : String(v)
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);

export function readOwnerToken() {
  if (process.env.CONSOLE_OWNER_TOKEN) return process.env.CONSOLE_OWNER_TOKEN.trim();
  const file = path.join(dataDir, 'owner-token');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    fail(`owner token not found: set CONSOLE_OWNER_TOKEN or start the console so ${file} exists`, 2);
  }
}

export function fail(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

export function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/** fetch wrapper: returns { status, body } and never throws on HTTP errors. */
export async function api(token, method, pathname, body) {
  const headers = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(consoleUrl + pathname, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (err) {
    fail(`cannot reach console at ${consoleUrl}: ${err instanceof Error ? err.message : err}`, 2);
  }
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

export function describeError(res) {
  const e = res.body && typeof res.body === 'object' && res.body.error ? res.body.error : null;
  return e ? `${res.status} ${e.code}: ${e.message}${e.details ? ' ' + JSON.stringify(e.details) : ''}` : `${res.status} ${JSON.stringify(res.body)}`;
}

/** Print the body on 2xx, otherwise print a readable error and exit non-zero. */
export function expectOk(res, exitCode = 1) {
  if (res.status >= 200 && res.status < 300) {
    printJson(res.body);
    return res.body;
  }
  fail(describeError(res), exitCode);
}

export function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`cannot read JSON file ${file}: ${err instanceof Error ? err.message : err}`);
  }
}

export const newClientId = () => crypto.randomUUID();
