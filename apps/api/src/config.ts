import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const FOOTBALLOS_ENVS = ['development', 'demo', 'research', 'production'] as const;
export type FootballOsEnv = (typeof FOOTBALLOS_ENVS)[number];

const DEV_SESSION_SECRET = 'footballos-development-only-session-secret-not-for-production';

const boolString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FOOTBALLOS_ENV: z.enum(FOOTBALLOS_ENVS).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().min(1).default('127.0.0.1'),
  FOOTBALLOS_DATA_DIR: z.string().min(1).default('.data/dev'),
  PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_SECRET: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().positive().default(30),
  COOKIE_SECURE: boolString.default(false),
  MODEL_PROVIDER: z.enum(['anthropic', 'openai', 'none']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  MODEL_ID: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(21474836480),
  UPLOAD_CHUNK_BYTES: z.coerce.number().int().positive().default(16777216),
  ALLOWED_VIDEO_CONTAINERS: z.string().default('mp4,mov,mkv'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(0).default(1),
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOB_LEASE_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_FRAMES_PER_SEGMENT: z.coerce.number().int().positive().default(12),
  MONTHLY_COST_CAP_USD: z.coerce.number().nonnegative().default(0),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  SIGN_IN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  SIGN_IN_RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(900),
  INVITE_TTL_HOURS: z.coerce.number().positive().default(24 * 7),
  RECOVERY_TOKEN_TTL_MINUTES: z.coerce.number().positive().default(60),
  /** log2 of the scrypt cost parameter N. 17 (OWASP) in real use; tests lower it for speed. */
  PASSWORD_SCRYPT_LOG2N: z.coerce.number().int().min(10).max(20).default(17),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  environment: FootballOsEnv;
  port: number;
  host: string;
  dataDir: string;
  publicOrigin: string;
  sessionSecret: string;
  sessionIdleHours: number;
  sessionAbsoluteDays: number;
  cookieSecure: boolean;
  modelProvider: 'anthropic' | 'openai' | 'none';
  /** Presence only; the key value is never copied out of process.env. */
  modelKeyConfigured: boolean;
  modelId: string | null;
  limits: {
    maxUploadBytes: number;
    uploadChunkBytes: number;
    allowedVideoContainers: string[];
    workerConcurrency: number;
    jobMaxAttempts: number;
    jobLeaseSeconds: number;
    maxFramesPerSegment: number;
    monthlyCostCapUsd: number;
  };
  logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  signInRateLimit: { max: number; windowSec: number };
  inviteTtlHours: number;
  recoveryTokenTtlMinutes: number;
  passwordScryptLog2N: number;
};

/** Loads `apps/api/.env` (or the file named by FOOTBALLOS_ENV_FILE) when present. Existing variables win. */
export function loadEnvFile(file = process.env.FOOTBALLOS_ENV_FILE ?? path.resolve(packageDir(), '.env')): void {
  if (!fs.existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
}

export function packageDir(): string {
  // src/config.ts -> apps/api ; dist/config.js -> apps/api
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const productionLike = e.FOOTBALLOS_ENV === 'production' || e.NODE_ENV === 'production';
  let sessionSecret = e.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    if (productionLike) {
      throw new Error('SESSION_SECRET must be set to at least 32 characters in production (e.g. `openssl rand -base64 48`)');
    }
    sessionSecret = DEV_SESSION_SECRET;
  }
  const providerKey = e.MODEL_PROVIDER === 'anthropic' ? e.ANTHROPIC_API_KEY : e.MODEL_PROVIDER === 'openai' ? e.OPENAI_API_KEY : undefined;
  return {
    nodeEnv: e.NODE_ENV,
    environment: e.FOOTBALLOS_ENV,
    port: e.PORT,
    host: e.HOST,
    dataDir: path.resolve(e.FOOTBALLOS_DATA_DIR),
    publicOrigin: e.PUBLIC_ORIGIN.replace(/\/$/, ''),
    sessionSecret,
    sessionIdleHours: e.SESSION_TTL_HOURS,
    sessionAbsoluteDays: e.SESSION_ABSOLUTE_DAYS,
    cookieSecure: e.COOKIE_SECURE,
    modelProvider: e.MODEL_PROVIDER,
    modelKeyConfigured: Boolean(providerKey && providerKey.length > 0),
    modelId: e.MODEL_ID && e.MODEL_ID.length > 0 ? e.MODEL_ID : null,
    limits: {
      maxUploadBytes: e.MAX_UPLOAD_BYTES,
      uploadChunkBytes: e.UPLOAD_CHUNK_BYTES,
      allowedVideoContainers: e.ALLOWED_VIDEO_CONTAINERS.split(',').map((s) => s.trim()).filter(Boolean),
      workerConcurrency: e.WORKER_CONCURRENCY,
      jobMaxAttempts: e.JOB_MAX_ATTEMPTS,
      jobLeaseSeconds: e.JOB_LEASE_SECONDS,
      maxFramesPerSegment: e.MAX_FRAMES_PER_SEGMENT,
      monthlyCostCapUsd: e.MONTHLY_COST_CAP_USD,
    },
    logLevel: e.LOG_LEVEL,
    signInRateLimit: { max: e.SIGN_IN_RATE_LIMIT_MAX, windowSec: e.SIGN_IN_RATE_LIMIT_WINDOW_SEC },
    inviteTtlHours: e.INVITE_TTL_HOURS,
    recoveryTokenTtlMinutes: e.RECOVERY_TOKEN_TTL_MINUTES,
    passwordScryptLog2N: e.PASSWORD_SCRYPT_LOG2N,
  };
}

/** True when operational secrets (recovery tokens) may be written to the server log instead of e-mailed. */
export function logsRecoveryTokens(config: AppConfig): boolean {
  return config.environment === 'demo' || config.environment === 'development';
}
