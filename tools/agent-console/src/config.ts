import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  dataDir: string;
  repoRoot: string;
  staleAfterMin: number;
  leadPickupAfterSec: number;
  uiDist: string;
}

/** Directory of this package (tools/agent-console), independent of the cwd. */
export const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Walk up from `start` to the nearest directory whose package.json declares `workspaces`
 * (the monorepo root). Returns null when none is found.
 */
export function findWorkspaceRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    try {
      const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
      if (parsed && parsed.workspaces !== undefined) return dir;
    } catch {
      // no package.json here, or not JSON: keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Repo root: CONSOLE_REPO_ROOT, else the nearest workspace root above this package, else ../.. */
export function resolveRepoRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CONSOLE_REPO_ROOT) return path.resolve(env.CONSOLE_REPO_ROOT);
  return findWorkspaceRoot(packageDir) ?? path.resolve(packageDir, '..', '..');
}

/**
 * Data directory: CONSOLE_DATA_DIR (or DATA_DIR), resolved against the repo root when relative
 * (QA observation O-1: `npm run -w` sets the cwd to the package dir, so a relative value used to
 * land under tools/agent-console). Default `<repo root>/.data/console`.
 */
export function resolveDataDir(repoRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CONSOLE_DATA_DIR || env.DATA_DIR;
  if (!raw) return path.join(repoRoot, '.data', 'console');
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(repoRoot, raw);
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const repoRoot = overrides.repoRoot ?? resolveRepoRoot();
  const dataDir = overrides.dataDir ?? resolveDataDir(repoRoot);
  return {
    port: overrides.port ?? intEnv('CONSOLE_PORT', 4800),
    dataDir,
    repoRoot,
    staleAfterMin: overrides.staleAfterMin ?? intEnv('STALE_AFTER_MIN', 20),
    leadPickupAfterSec: overrides.leadPickupAfterSec ?? intEnv('LEAD_PICKUP_AFTER_SEC', 90),
    uiDist: overrides.uiDist ?? path.resolve(packageDir, '..', 'agent-console-ui', 'dist'),
  };
}
