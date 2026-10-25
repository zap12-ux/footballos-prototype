#!/usr/bin/env node
// Online SQLite backup with integrity check and sha256 sidecar.
// Usage: node scripts/backup-sqlite.mjs --db <path> --out <dir> [--keep N]
import { backupSqlite, parseArgs, OpsError } from '@footballos/ops/sqlite-backup';

try {
  const args = parseArgs(process.argv.slice(2), { strings: ['db', 'out', 'keep'] });
  if (!args.db || !args.out) throw new OpsError('Usage: backup-sqlite --db <path> --out <dir> [--keep N]');
  const keep = args.keep === undefined ? undefined : Number(args.keep);
  const result = await backupSqlite({ db: args.db, outDir: args.out, keep });
  console.log(`backup ok ${result.file} sha256=${result.sha256} bytes=${result.bytes}`);
  for (const r of result.removed) console.log(`rotated out ${r}`);
} catch (err) {
  console.error(`backup FAILED: ${err.message}`);
  process.exit(1);
}
