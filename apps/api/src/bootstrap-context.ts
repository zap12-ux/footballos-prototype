import fs from 'node:fs';
import path from 'node:path';
import { JobRunner } from '@footballos/media';
import { loadConfig, packageDir, type AppConfig } from './config.js';
import { openDatabase, type OpenedDatabase } from './db/db.js';
import { createLogger, type Logger } from './logger.js';
import { RateLimiter } from './auth/ratelimit.js';
import type { AppContext } from './context.js';
import { SqliteJobStore } from './jobs/sqlite-store.js';
import { registerJobHandlers } from './jobs/worker.js';
import { ensureStorageDirs } from './services/storage.js';

export function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export type BuiltContext = { ctx: AppContext; opened: OpenedDatabase; close: () => void };

/** Opens the database (running migrations), prepares private storage and assembles the request context plus the job runner. */
export function buildContext(options: { config?: AppConfig; logger?: Logger; now?: () => Date; workerId?: string } = {}): BuiltContext {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel, { service: 'footballos-api', env: config.environment });
  const opened = openDatabase(config.dataDir);
  ensureStorageDirs(config);
  const now = options.now ?? (() => new Date());
  const jobStore = new SqliteJobStore(opened.db);
  const runner = new JobRunner({
    store: jobStore,
    workerId: options.workerId,
    leaseSec: config.limits.jobLeaseSeconds,
    heartbeatSec: Math.max(1, Math.min(5, Math.floor(config.limits.jobLeaseSeconds / 3))),
    pollIntervalMs: config.limits.workerPollMs,
    defaultMaxAttempts: config.limits.jobMaxAttempts,
    now,
  });
  const ctx: AppContext = {
    config,
    db: opened.db,
    logger,
    signInLimiter: new RateLimiter(config.signInRateLimit.max, config.signInRateLimit.windowSec * 1000),
    mfaLimiter: new RateLimiter(config.signInRateLimit.max, config.signInRateLimit.windowSec * 1000),
    now,
    version: readVersion(),
    jobStore,
    runner,
  };
  registerJobHandlers(ctx);
  return { ctx, opened, close: () => opened.close() };
}
