import type { JobRunner } from '@footballos/media';
import type { AppConfig } from './config.js';
import type { Db } from './db/db.js';
import type { Logger } from './logger.js';
import type { RateLimiter } from './auth/ratelimit.js';
import type { SqliteJobStore } from './jobs/sqlite-store.js';

/** Everything a request handler needs; built once per process (or per test file). */
export type AppContext = {
  config: AppConfig;
  db: Db;
  logger: Logger;
  signInLimiter: RateLimiter;
  mfaLimiter: RateLimiter;
  /** Injected clock so tests can move time. */
  now: () => Date;
  version: string;
  /** SQLite-backed job store shared by the API routes and the worker (same database file). */
  jobStore: SqliteJobStore;
  /**
   * The `packages/media` JobRunner with every handler registered. Routes use it to enqueue and to
   * abort in-flight jobs; it is started only by `src/worker.ts` or when `WORKER_INLINE=true`.
   */
  runner: JobRunner;
};
