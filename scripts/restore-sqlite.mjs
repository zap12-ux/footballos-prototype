#!/usr/bin/env node
// Verified SQLite restore. Stop the API first.
// Usage: node scripts/restore-sqlite.mjs --from <backup.db> --db <path> [--force]
import { restoreSqlite, parseArgs, OpsError } from '@footballos/ops/sqlite-backup';

try {
  const args = parseArgs(process.argv.slice(2), { strings: ['from', 'db'], booleans: ['force'] });
  if (!args.from || !args.db) throw new OpsError('Usage: restore-sqlite --from <backup.db> --db <path> [--force]');
  const result = restoreSqlite({ from: args.from, db: args.db, force: Boolean(args.force) });
  console.log(`restore ok ${result.db} sha256=${result.sha256}`);
  if (result.preRestore) console.log(`previous database kept at ${result.preRestore}`);
} catch (err) {
  console.error(`restore FAILED: ${err.message}`);
  process.exit(1);
}
