// SQLite online backup and verified restore for FootballOS.
//
// Backups use SQLite's online backup API (better-sqlite3 `db.backup()`), which yields a
// consistent snapshot, including committed WAL content, while the API keeps running. Every
// copy is integrity-checked before it is kept and gets a `<file>.sha256` sidecar in
// `sha256sum` format. Restores verify that checksum, refuse to replace an existing database
// unless forced, and keep whatever they replace as `*.pre-restore`.
//
// Restore must run with the API stopped: replacing a database under a live connection is
// not safe, and this module cannot detect other processes holding it open.

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

export class OpsError extends Error {}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function integrityCheck(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const rows = db.pragma('integrity_check', { simple: false });
    return rows.map((r) => r.integrity_check);
  } finally {
    db.close();
  }
}

function fsyncPath(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// UTC, sortable, millisecond precision so two backups in one second do not collide.
function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '');
}

function backupPrefix(dbPath) {
  const name = basename(dbPath);
  return `${name.slice(0, name.length - extname(name).length) || name}-`;
}

/**
 * Back up `db` into `outDir`. Returns { file, sha256, bytes, removed }.
 * `keep` (optional, >= 1) deletes the oldest backups of the same database beyond that count.
 */
export async function backupSqlite({ db, outDir, keep, now = new Date() }) {
  const dbPath = resolve(db);
  if (!existsSync(dbPath)) throw new OpsError(`Database not found: ${dbPath}`);
  if (keep !== undefined && (!Number.isInteger(keep) || keep < 1)) {
    throw new OpsError(`--keep must be a positive integer, got ${keep}`);
  }
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });

  const prefix = backupPrefix(dbPath);
  const file = join(dir, `${prefix}${stamp(now)}.db`);
  if (existsSync(file)) throw new OpsError(`Backup already exists: ${file}`);
  const partial = `${file}.partial`;

  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(partial);
  } catch (err) {
    rmSync(partial, { force: true });
    throw err;
  } finally {
    source.close();
  }

  // The copy inherits WAL mode; switch it to a rollback journal so the backup is one
  // self-contained file and opening it never leaves -wal/-shm files beside it.
  const copy = new Database(partial, { fileMustExist: true });
  try { copy.pragma('journal_mode = DELETE'); } finally { copy.close(); }

  const problems = integrityCheck(partial);
  if (problems.length !== 1 || problems[0] !== 'ok') {
    rmSync(partial, { force: true });
    throw new OpsError(`Integrity check failed on backup copy: ${problems.slice(0, 5).join('; ')}`);
  }
  fsyncPath(partial);
  renameSync(partial, file);

  const sha256 = sha256File(file);
  writeFileSync(`${file}.sha256`, `${sha256}  ${basename(file)}\n`);

  const removed = [];
  if (keep !== undefined) {
    const backups = readdirSync(dir)
      .filter((n) => n.startsWith(prefix) && n.endsWith('.db'))
      .sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
      rmSync(join(dir, old), { force: true });
      rmSync(join(dir, `${old}.sha256`), { force: true });
      removed.push(join(dir, old));
    }
  }
  return { file, sha256, bytes: readFileSync(file).length, removed };
}

function readSidecar(from) {
  const sidecar = `${from}.sha256`;
  if (!existsSync(sidecar)) throw new OpsError(`Checksum file missing: ${sidecar}`);
  const match = /^([0-9a-f]{64})\b/.exec(readFileSync(sidecar, 'utf8').trim());
  if (!match) throw new OpsError(`Checksum file is not in sha256sum format: ${sidecar}`);
  return match[1];
}

/**
 * Restore backup `from` to database path `db`. Returns { db, sha256, preRestore }.
 * Refuses to replace an existing database unless `force`; the replaced database (and any
 * -wal/-shm files, which would otherwise be replayed onto the restored copy) is moved to
 * `<db>.<stamp>.pre-restore`.
 */
export function restoreSqlite({ from, db, force = false, now = new Date() }) {
  const src = resolve(from);
  const dbPath = resolve(db);
  if (!existsSync(src)) throw new OpsError(`Backup not found: ${src}`);

  const expected = readSidecar(src);
  const actual = sha256File(src);
  if (actual !== expected) {
    throw new OpsError(`Checksum mismatch for ${src}: expected ${expected}, got ${actual}`);
  }
  const problems = integrityCheck(src);
  if (problems.length !== 1 || problems[0] !== 'ok') {
    throw new OpsError(`Backup fails integrity check: ${problems.slice(0, 5).join('; ')}`);
  }

  const existing = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((p) => existsSync(p));
  if (existing.length && !force) {
    throw new OpsError(`Refusing to overwrite ${dbPath}; pass --force (the current file is kept as .pre-restore)`);
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const staging = `${dbPath}.restoring`;
  copyFileSync(src, staging);
  fsyncPath(staging);
  if (sha256File(staging) !== expected) {
    rmSync(staging, { force: true });
    throw new OpsError('Copied file does not match the backup checksum');
  }

  let preRestore = null;
  if (existing.length) {
    const base = `${dbPath}.${stamp(now)}`;
    for (const p of existing) renameSync(p, `${base}${p.slice(dbPath.length)}.pre-restore`);
    preRestore = `${base}.pre-restore`;
  }
  renameSync(staging, dbPath);
  return { db: dbPath, sha256: expected, preRestore };
}

// Minimal `--flag value` parser shared by the two CLIs in scripts/.
export function parseArgs(argv, { strings = [], booleans = [] }) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (booleans.includes(key)) out[key] = true;
    else if (strings.includes(key) && i + 1 < argv.length) out[key] = argv[++i];
    else throw new OpsError(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return out;
}
