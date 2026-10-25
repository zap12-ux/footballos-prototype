import type { AppConfig } from './config.js';
import type { Db } from './db/db.js';
import type { Logger } from './logger.js';
import type { RateLimiter } from './auth/ratelimit.js';

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
};
