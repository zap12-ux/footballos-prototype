#!/usr/bin/env node
// QA fixture helper (task B6, check 9): makes an asset LOOK older by moving its `created_at` back
// `days` days in the SQLite database, so a retention of 1 day can be exercised without waiting a
// day. After this, re-PATCH team settings (retentionDays to another value and back) so the server
// recomputes `retention_until` from the new created_at, then restart the server (maintenance tick).
//
//   FOOTBALLOS_DATA_DIR=<abs> FOOTBALLOS_ENV=demo node tests/e2e/b6-age-asset.mjs <assetId> [days=3]
//
// Uses the API's own better-sqlite3 dependency (no new dependency). Refuses production.

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if ((process.env.FOOTBALLOS_ENV || '') === 'production' || (process.env.NODE_ENV || '') === 'production') {
  console.error('refusing to alter fixture data in a production environment');
  process.exit(2);
}
if (!process.env.FOOTBALLOS_DATA_DIR) {
  console.error('FOOTBALLOS_DATA_DIR is required');
  process.exit(2);
}
const [assetId, daysArg = '3'] = process.argv.slice(2);
if (!assetId) {
  console.error('usage: b6-age-asset.mjs <assetId> [days]');
  process.exit(2);
}
const days = Number(daysArg);
const require = createRequire(path.resolve(here, '..', '..', 'apps', 'api', 'package.json'));
const Database = require('better-sqlite3');
const db = new Database(path.join(process.env.FOOTBALLOS_DATA_DIR, 'footballos.sqlite'));
try {
  const row = db.prepare('SELECT id, created_at, retention_until, status FROM media_assets WHERE id = ?').get(assetId);
  if (!row) throw new Error(`asset ${assetId} not found`);
  const createdAt = new Date(Date.now() - days * 86_400_000).toISOString();
  db.prepare('UPDATE media_assets SET created_at = ? WHERE id = ?').run(createdAt, assetId);
  process.stdout.write(JSON.stringify({ assetId, status: row.status, previousCreatedAt: row.created_at, createdAt, retentionUntil: row.retention_until }) + '\n');
} finally {
  db.close();
}
