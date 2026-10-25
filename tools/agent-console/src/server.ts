import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig, type Config } from './config.js';
import { openDb } from './db.js';
import { Service } from './service.js';
import { Store } from './store.js';

export function loadOrCreateOwnerToken(dataDir: string): string {
  const file = path.join(dataDir, 'owner-token');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    // create below
  }
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(file, token + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return token;
}

export interface RunningServer {
  config: Config;
  service: Service;
  ownerToken: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function startServer(overrides: Partial<Config> = {}, log = console.log): Promise<RunningServer> {
  const config = loadConfig(overrides);
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(path.join(config.dataDir, 'console.db'));
  const store = new Store(db);
  const service = new Service(store, config);
  const ownerToken = loadOrCreateOwnerToken(config.dataDir);

  const app = createApp({
    service,
    ownerToken,
    port: config.port,
    repoRoot: config.repoRoot,
    uiDist: config.uiDist,
  });

  let server: ReturnType<typeof serve> | undefined;
  const port = await new Promise<number>((resolve, reject) => {
    const srv = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: config.port }, (info) => resolve(info.port));
    srv.on('error', reject);
    server = srv;
  });

  const url = `http://127.0.0.1:${port}`;
  const latest = service.latestLiveRun();
  log(`CONSOLE_URL=${url}/#token=${ownerToken}`);
  log(`CONSOLE_STATE=listening data_dir=${config.dataDir} run=${latest?.id ?? 'none'}`);

  return {
    config: { ...config, port },
    service,
    ownerToken,
    port,
    url,
    close: () =>
      new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => {
          db.close();
          resolve();
        });
        // Node keeps SSE sockets open; force-close them so shutdown is prompt.
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().then(
    (running) => {
      const shutdown = () => {
        console.error('[console] shutting down');
        running.close().finally(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    },
    (err) => {
      console.error('[console] failed to start:', err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
