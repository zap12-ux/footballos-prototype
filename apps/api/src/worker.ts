/**
 * Standalone job worker: `npm run worker -w apps/api`. Opens the same FOOTBALLOS_DATA_DIR as the
 * API, recovers expired leases, then claims and runs validate / proxy / thumbnails / segment /
 * infer_labels jobs (CONTRACTS §14.2). Run this instead of WORKER_INLINE=true when the API and the
 * worker should be separate processes.
 */
import { loadConfig, loadEnvFile } from './config.js';
import { buildContext } from './bootstrap-context.js';
import { startWorker } from './jobs/worker.js';

loadEnvFile();
const config = loadConfig();
const { ctx, close } = buildContext({ config });
const stop = await startWorker(ctx);
ctx.logger.info('FootballOS worker running', { dataDir: config.dataDir, modelProvider: config.modelProvider, model: config.ai.anthropicModel });

async function shutdown(signal: string) {
  ctx.logger.info('worker shutting down', { signal });
  await stop();
  close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
