import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupSqlite, restoreSqlite, sha256File } from '../src/sqlite-backup.mjs';

const REPO = resolve(import.meta.dirname, '../../..');
let dir;

function makeDb(path, rows) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS plays (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO plays (label) VALUES (?)');
  for (const r of rows) insert.run(r);
  return db;
}

const labels = (path) => {
  const db = new Database(path, { readonly: true });
  try { return db.prepare('SELECT label FROM plays ORDER BY id').all().map((r) => r.label); }
  finally { db.close(); }
};

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'footballos-ops-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('backupSqlite', () => {
  it('captures committed WAL content from a database that is still open, with a valid sidecar', async () => {
    const live = makeDb(join(dir, 'footballos.db'), ['shotgun', 'pistol']);
    // Rows still in the WAL (no checkpoint) must be in the backup.
    expect(existsSync(join(dir, 'footballos.db-wal'))).toBe(true);
    const result = await backupSqlite({ db: join(dir, 'footballos.db'), outDir: join(dir, 'backups') });
    live.close();

    expect(labels(result.file)).toEqual(['shotgun', 'pistol']);
    const sidecar = readFileSync(`${result.file}.sha256`, 'utf8');
    expect(sidecar).toBe(`${sha256File(result.file)}  ${result.file.split('/').pop()}\n`);
    // A backup is one self-contained file: no partials or WAL sidecars left behind.
    expect(readdirSync(join(dir, 'backups')).sort()).toEqual(
      [result.file, `${result.file}.sha256`].map((p) => p.split('/').pop()));
    const copy = new Database(result.file, { readonly: true });
    expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
    copy.close();
  });

  it('rotates to the newest N backups and removes their sidecars', async () => {
    makeDb(join(dir, 'footballos.db'), ['i-form']).close();
    const out = join(dir, 'backups');
    const made = [];
    for (let i = 0; i < 4; i++) {
      made.push(await backupSqlite({
        db: join(dir, 'footballos.db'), outDir: out, keep: 2, now: new Date(Date.UTC(2026, 9, 25, 3, 0, i)),
      }));
    }
    expect(readdirSync(out).sort()).toEqual([
      made[2].file, `${made[2].file}.sha256`, made[3].file, `${made[3].file}.sha256`,
    ].map((p) => p.split('/').pop()));
  });

  it('fails without writing a backup when the database is missing or keep is invalid', async () => {
    await expect(backupSqlite({ db: join(dir, 'nope.db'), outDir: dir })).rejects.toThrow(/not found/);
    makeDb(join(dir, 'footballos.db'), []).close();
    await expect(backupSqlite({ db: join(dir, 'footballos.db'), outDir: dir, keep: 0 })).rejects.toThrow(/--keep/);
  });
});

describe('restoreSqlite', () => {
  async function backupOf(rows) {
    makeDb(join(dir, 'source.db'), rows).close();
    return (await backupSqlite({ db: join(dir, 'source.db'), outDir: join(dir, 'backups') })).file;
  }

  it('restores into an empty location', async () => {
    const file = await backupOf(['trips', 'bunch']);
    const result = restoreSqlite({ from: file, db: join(dir, 'restored', 'footballos.db') });
    expect(result.preRestore).toBeNull();
    expect(labels(join(dir, 'restored', 'footballos.db'))).toEqual(['trips', 'bunch']);
  });

  it('refuses to overwrite an existing database without force', async () => {
    const file = await backupOf(['trips']);
    makeDb(join(dir, 'footballos.db'), ['current']).close();
    expect(() => restoreSqlite({ from: file, db: join(dir, 'footballos.db') })).toThrow(/Refusing to overwrite/);
    expect(labels(join(dir, 'footballos.db'))).toEqual(['current']);
  });

  it('with force, keeps the replaced database and its WAL as .pre-restore, and stale WAL is not replayed', async () => {
    const file = await backupOf(['backup-row']);
    const current = makeDb(join(dir, 'footballos.db'), ['current-row']);
    // Leave an un-checkpointed WAL next to the target, as a crashed process would.
    const wal = readFileSync(join(dir, 'footballos.db-wal'));
    current.close();
    writeFileSync(join(dir, 'footballos.db-wal'), wal);

    const now = new Date(Date.UTC(2026, 9, 25, 4, 0, 0));
    const result = restoreSqlite({ from: file, db: join(dir, 'footballos.db'), force: true, now });
    expect(labels(join(dir, 'footballos.db'))).toEqual(['backup-row']);
    expect(result.preRestore).toBe(join(dir, 'footballos.db.20261025T040000000Z.pre-restore'));
    expect(existsSync(join(dir, 'footballos.db.20261025T040000000Z-wal.pre-restore'))).toBe(true);
    expect(labels(result.preRestore)).toEqual(['current-row']);
  });

  it('rejects a backup whose checksum does not match or whose sidecar is missing', async () => {
    const file = await backupOf(['trips']);
    writeFileSync(`${file}.sha256`, `${'0'.repeat(64)}  x.db\n`);
    expect(() => restoreSqlite({ from: file, db: join(dir, 'a.db') })).toThrow(/Checksum mismatch/);
    rmSync(`${file}.sha256`);
    expect(() => restoreSqlite({ from: file, db: join(dir, 'a.db') })).toThrow(/Checksum file missing/);
    expect(existsSync(join(dir, 'a.db'))).toBe(false);
  });
});

describe('CLI wrappers in scripts/', () => {
  it('backs up and restores end to end, and exits 1 on refusal', () => {
    makeDb(join(dir, 'footballos.db'), ['empty-set']).close();
    const run = (script, args) => execFileSync('node', [join(REPO, 'scripts', script), ...args], { encoding: 'utf8' });
    const out = run('backup-sqlite.mjs', ['--db', join(dir, 'footballos.db'), '--out', join(dir, 'b'), '--keep', '3']);
    const file = /backup ok (\S+)/.exec(out)[1];
    expect(() => run('restore-sqlite.mjs', ['--from', file, '--db', join(dir, 'footballos.db')])).toThrow();
    expect(run('restore-sqlite.mjs', ['--from', file, '--db', join(dir, 'footballos.db'), '--force'])).toMatch(/restore ok/);
  });
});
