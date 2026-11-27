import { serve } from '@hono/node-server';
import { loadConfig, loadEnvFile } from './config.js';
import { buildContext } from './bootstrap-context.js';
import { createApp } from './app.js';
import { startWorker } from './jobs/worker.js';

loadEnvFile();
const config = loadConfig();
const { ctx, close } = buildContext({ config });
const app = createApp(ctx);
let stopWorker: (() => Promise<void>) | null = null;
if (config.limits.workerInline) {
  stopWorker = await startWorker(ctx);
}

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  ctx.logger.info('FootballOS API listening', {
    url: `http://${info.address}:${info.port}`,
    environment: config.environment,
    dataDir: config.dataDir,
    ollamaHost: config.ai.ollamaHost,
    model: config.ai.model,
    workerInline: config.limits.workerInline,
  });
});

function shutdown(signal: string) {
  ctx.logger.info('shutting down', { signal });
  server.close(() => {
    void (stopWorker ? stopWorker() : Promise.resolve()).finally(() => {
      close();
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
