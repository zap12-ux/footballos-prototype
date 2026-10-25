#!/usr/bin/env node
// QA helper (task B6, check 6): forces a RE-RUN of a chain job (default `segment`) for an asset.
// No HTTP route re-runs a succeeded job (`POST /jobs/:id/retry` is only for failed/canceled, and a
// second `complete` returns the existing chain), so this enqueues a fresh job through the API's
// built job store with a QA-suffixed configVersion (new idempotency key). The RUNNING server's
// inline worker claims and executes it against the same SQLite file (WAL), so the persistence path
// (`persistResult` → `storeProposedSegments`) is the real one.
//
//   FOOTBALLOS_DATA_DIR=<abs> FOOTBALLOS_ENV=demo node tests/e2e/b6-rerun-job.mjs <assetId> [segment|proxy|thumbnails|validate]
//
// Prints JSON { jobId, kind, configVersion }. Refuses production. Requires `npm run build -w apps/api`.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', '..', 'apps', 'api', 'dist');
if ((process.env.FOOTBALLOS_ENV || '') === 'production' || (process.env.NODE_ENV || '') === 'production') {
  console.error('refusing to enqueue fixture jobs in a production environment');
  process.exit(2);
}
if (!process.env.FOOTBALLOS_DATA_DIR) {
  console.error('FOOTBALLOS_DATA_DIR is required');
  process.exit(2);
}
const [assetId, kind = 'segment'] = process.argv.slice(2);
if (!assetId || !['validate', 'proxy', 'thumbnails', 'segment'].includes(kind)) {
  console.error('usage: b6-rerun-job.mjs <assetId> [validate|proxy|thumbnails|segment]');
  process.exit(2);
}
// The worker loop must not run in this process: WORKER_CONCURRENCY=0 keeps the runner idle and the
// server's worker does the work.
process.env.WORKER_CONCURRENCY = '0';
process.env.WORKER_INLINE = 'false';

const { buildContext } = await import(path.join(dist, 'bootstrap-context.js'));
const { getAsset, chainConfigVersion } = await import(path.join(dist, 'services', 'media.js'));
const { enqueueJob } = await import(path.join(dist, 'jobs', 'enqueue.js'));
const { absolutePath, assetDirKey } = await import(path.join(dist, 'services', 'storage.js'));

const { ctx, close } = buildContext({});
try {
  const asset = getAsset(ctx, assetId);
  if (!asset) throw new Error(`asset ${assetId} not found`);
  const configVersion = `${chainConfigVersion(ctx)}:qa-rerun-${Date.now()}`;
  const outDir = absolutePath(ctx.config, assetDirKey(asset.teamId, asset.id));
  const input = { assetId: asset.id, teamId: asset.teamId, gameId: asset.gameId, sourcePath: absolutePath(ctx.config, asset.storageKey), outDir };
  const { job, duplicate } = await enqueueJob(ctx, { teamId: asset.teamId, assetId: asset.id, kind, input, requestedBy: 'qa-rerun', keyInputs: { assetId: asset.id }, configVersion, dependsOnJobId: null });
  process.stdout.write(JSON.stringify({ jobId: job.id, kind, configVersion, duplicate }) + '\n');
} finally {
  close();
}
