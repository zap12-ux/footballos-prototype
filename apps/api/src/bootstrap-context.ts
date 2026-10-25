import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, packageDir, type AppConfig } from './config.js';
import { openDatabase, type OpenedDatabase } from './db/db.js';
import { createLogger, type Logger } from './logger.js';
import { RateLimiter } from './auth/ratelimit.js';
import type { AppContext } from './context.js';

export function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageDir(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export type BuiltContext = { ctx: AppContext; opened: OpenedDatabase; close: () => void };

/** Opens the database (running migrations) and assembles the request context. */
export function buildContext(options: { config?: AppConfig; logger?: Logger; now?: () => Date } = {}): BuiltContext {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel, { service: 'footballos-api', env: config.environment });
  const opened = openDatabase(config.dataDir);
  const ctx: AppContext = {
    config,
    db: opened.db,
    logger,
    signInLimiter: new RateLimiter(config.signInRateLimit.max, config.signInRateLimit.windowSec * 1000),
    mfaLimiter: new RateLimiter(config.signInRateLimit.max, config.signInRateLimit.windowSec * 1000),
    now: options.now ?? (() => new Date()),
    version: readVersion(),
  };
  return { ctx, opened, close: () => opened.close() };
}
