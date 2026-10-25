import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { packageDir } from '../config.js';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;
export const DB_FILENAME = 'footballos.sqlite';

export function migrationsFolder(): string {
  return path.join(packageDir(), 'drizzle');
}

export type OpenedDatabase = { db: Db; sqlite: Database.Database; file: string; close: () => void };

/**
 * Opens (creating when needed) the SQLite database under `dataDir` and applies all committed
 * Drizzle migrations from `apps/api/drizzle`. Safe to call on every start.
 */
export function openDatabase(dataDir: string): OpenedDatabase {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const sub of ['media', 'backups']) fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  const file = path.join(dataDir, DB_FILENAME);
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  // Migrations run inside one transaction, where `PRAGMA foreign_keys` is a no-op; a table rebuild
  // (0003_coaching makes media_assets.game_id nullable) would otherwise cascade-delete child rows
  // when the old table is dropped. Enforcement is off only while migrating and the result is checked.
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder: migrationsFolder() });
  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    sqlite.close();
    throw new Error(`database at ${file} has ${violations.length} foreign key violation(s) after migration; refusing to start`);
  }
  sqlite.pragma('foreign_keys = ON');
  return { db, sqlite, file, close: () => sqlite.close() };
}

export function nowIso(): string {
  return new Date().toISOString();
}
